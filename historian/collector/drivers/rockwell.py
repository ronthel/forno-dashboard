"""
Driver Rockwell.

- rockwell_logix -> CompactLogix / ControlLogix (tag-based, protocolo CIP)
  usa pycomm3.LogixDriver, que suporta leitura em lote (várias tags numa
  única requisição), essencial para performance com milhares de tags.

- rockwell_pccc -> MicroLogix / SLC500 (não é tag-based; endereçamento tipo
  N7:0, B3:0/1, F8:0 etc). Usa pycomm3.SLCDriver.
"""
import logging
import re
import time
from collections import defaultdict
from typing import Any, Dict, List

from pycomm3 import LogixDriver, SLCDriver

from .base import BaseDriver

logger = logging.getLogger("wtecc.driver.rockwell")

# Reconhece endereços do tipo "TESTE_HIST[42]" — tag cadastrada como um
# elemento individual de um array do CLP. Usado para agrupar leituras.
_ARRAY_ELEMENT_RE = re.compile(r"^(?P<base>[A-Za-z_][\w:.]*)\[(?P<idx>\d+)\]$")

# Depois de falhar essa quantidade de vezes SEGUIDAS, um endereço "normal"
# (não-array) entra em quarentena — evita continuar incluindo uma tag
# permanentemente quebrada (endereço errado, tag apagada no CLP etc) em
# toda requisição, ciclo após ciclo, pra sempre.
ADDRESS_FAILURE_THRESHOLD = 5
ADDRESS_QUARANTINE_SECONDS = 300  # 5 minutos


class RockwellLogixDriver(BaseDriver):
    """CompactLogix / ControlLogix via CIP (tag-based)."""

    def __init__(self, plc_config: dict):
        super().__init__(plc_config)
        slot = plc_config.get("slot") or 0
        self._path = f"{self.ip}/{slot}"
        self._driver: LogixDriver | None = None
        self._address_failures: Dict[str, int] = {}
        self._address_quarantined_until: Dict[str, float] = {}

    def connect(self) -> bool:
        try:
            self._driver = LogixDriver(self._path)
            self._driver.open()
            return self._driver.connected
        except Exception as exc:
            logger.error("Falha ao conectar em %s (%s): %s", self.name, self._path, exc)
            return False

    def disconnect(self) -> None:
        if self._driver:
            self._driver.close()

    @property
    def is_connected(self) -> bool:
        return bool(self._driver and self._driver.connected)

    def read_tags(self, tags: List[dict]) -> Dict[int, Any]:
        if not self.is_connected:
            return {}

        # Separa tags que são elementos de um mesmo array (ex: TESTE_HIST[0],
        # TESTE_HIST[1], ... TESTE_HIST[1999]) das tags "normais". Para os
        # arrays, em vez de pedir 2000 endereços individuais, faz UMA única
        # leitura em bloco (ex: "TESTE_HIST[0]{2000}") — o CLP devolve os
        # 2000 valores de uma vez, amostrados no mesmo instante (leitura
        # atômica), com uma fração do overhead de protocolo de 2000
        # requisições de tag separadas.
        array_groups: Dict[str, List[tuple]] = defaultdict(list)
        plain_tags: List[tuple] = []

        for t in tags:
            match = _ARRAY_ELEMENT_RE.match(t["address"].strip())
            if match:
                array_groups[match.group("base")].append((int(match.group("idx")), t["id"]))
            else:
                plain_tags.append((t["address"], t["id"]))

        results: Dict[int, Any] = {}

        try:
            # --- leitura em bloco de cada array detectado ---
            for base, items in array_groups.items():
                indices = [i for i, _ in items]
                lo, hi = min(indices), max(indices)
                count = hi - lo + 1
                bulk_address = f"{base}[{lo}]{{{count}}}"

                r = self._driver.read(bulk_address)
                if r.error:
                    logger.warning(
                        "Erro lendo array %s (%d elementos) em %s: %s",
                        bulk_address, count, self.name, r.error,
                    )
                    continue

                values_list = r.value
                if not isinstance(values_list, (list, tuple)):
                    logger.warning(
                        "Leitura de array %s em %s não retornou uma lista (retornou %s) — "
                        "verifique se o endereço realmente é um array no CLP.",
                        bulk_address, self.name, type(values_list).__name__,
                    )
                    continue

                for idx, tag_id in items:
                    pos = idx - lo
                    if 0 <= pos < len(values_list):
                        results[tag_id] = values_list[pos]
                    else:
                        logger.warning(
                            "Índice %d fora do range lido (%d elementos) para %s em %s",
                            idx, len(values_list), base, self.name,
                        )

            # --- leitura das tags "normais" (não-array), como antes ---
            if plain_tags:
                # Várias tags podem apontar pro mesmo endereço (ex: duas
                # tags diferentes historizando o mesmo ponto do CLP com
                # regras distintas) — por isso cada endereço mapeia pra uma
                # LISTA de tag_ids, não pra um só. Um dict endereço->tag_id
                # único faria a segunda tag sobrescrever a primeira
                # silenciosamente, e qual delas "vence" mudaria a cada
                # recarga de configuração (a ordem das tags no banco não é
                # garantida) — exatamente o tipo de intermitência que
                # parece um problema de timeout mas não é.
                now = time.monotonic()
                addr_to_tag_ids: Dict[str, List[int]] = defaultdict(list)
                for addr, tid in plain_tags:
                    quarantined_until = self._address_quarantined_until.get(addr)
                    if quarantined_until is not None and now < quarantined_until:
                        continue  # endereço permanentemente quebrado, nem tenta
                    addr_to_tag_ids[addr].append(tid)

                if addr_to_tag_ids:
                    addresses = list(addr_to_tag_ids.keys())
                    read_results = self._driver.read(*addresses)
                    if not isinstance(read_results, list):
                        read_results = [read_results]

                    for r in read_results:
                        tag_ids = addr_to_tag_ids.get(r.tag)
                        if not tag_ids:
                            continue
                        if r.error:
                            count = self._address_failures.get(r.tag, 0) + 1
                            self._address_failures[r.tag] = count
                            logger.warning(
                                "Erro lendo tag %s em %s (tentativa %d/%d): %s",
                                r.tag, self.name, count, ADDRESS_FAILURE_THRESHOLD, r.error,
                            )
                            if count >= ADDRESS_FAILURE_THRESHOLD:
                                self._address_quarantined_until[r.tag] = now + ADDRESS_QUARANTINE_SECONDS
                                logger.error(
                                    "Endereço %s em %s falhou %d vezes seguidas — pausando a "
                                    "leitura dele por %ds (as outras tags continuam normalmente). "
                                    "Confira se o endereço/nome da tag existe de verdade no CLP. "
                                    "Se a tag foi criada recentemente no CLP, reinicie o coletor "
                                    "manualmente (tela do Historian) pra ele reconhecer o endereço novo.",
                                    r.tag, self.name, count, ADDRESS_QUARANTINE_SECONDS,
                                )
                            continue
                        self._address_failures[r.tag] = 0
                        for tag_id in tag_ids:
                            results[tag_id] = r.value

        except Exception as exc:
            logger.error("Falha na leitura em lote de %s: %s", self.name, exc)
            self._driver = None  # força reconexão no próximo ciclo

        return results


class RockwellPCCCDriver(BaseDriver):
    """MicroLogix / SLC500 via PCCC (endereçamento por arquivo: N7:0, B3:0/1...)."""

    def __init__(self, plc_config: dict):
        super().__init__(plc_config)
        self._driver: SLCDriver | None = None

    def connect(self) -> bool:
        try:
            self._driver = SLCDriver(self.ip)
            self._driver.open()
            return self._driver.connected
        except Exception as exc:
            logger.error("Falha ao conectar em %s (%s): %s", self.name, self.ip, exc)
            return False

    def disconnect(self) -> None:
        if self._driver:
            self._driver.close()

    @property
    def is_connected(self) -> bool:
        return bool(self._driver and self._driver.connected)

    def read_tags(self, tags: List[dict]) -> Dict[int, Any]:
        if not self.is_connected:
            return {}

        # PCCC não faz batch nativo tão eficiente quanto CIP; o driver da
        # pycomm3 ainda assim aceita múltiplos endereços por chamada.
        results: Dict[int, Any] = {}
        for t in tags:
            try:
                r = self._driver.read(t["address"])
                if r.error:
                    logger.warning("Erro lendo %s em %s: %s", t["address"], self.name, r.error)
                    continue
                results[t["id"]] = r.value
            except Exception as exc:
                logger.error("Falha lendo %s em %s: %s", t["address"], self.name, exc)
        return results
