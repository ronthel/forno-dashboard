"""
Driver Siemens (S7-300/400/1200/1500) via S7comm, usando python-snap7.

Endereçamento esperado no campo `address` da tag, ex:
  "DB1,DBX0.0" -> DB1, bit 0 do byte 0 (bool)
  "DB1,DBW4"   -> DB1, word no offset 4 (int, COM sinal)
  "DB1,DBD8"   -> DB1, double word no offset 8 (real, se data_type='real';
                  dint COM sinal, se data_type='dint')

Importante (TIA Portal): o DB precisa estar com "Optimized block access"
DESABILITADO (botão direito no DB -> Properties -> desmarcar essa opção)
para expor offsets fixos. Com acesso otimizado ligado (padrão em projetos
novos de S7-1200/1500), o compilador é livre pra reorganizar a memória do
DB a qualquer recompilação — não existe endereço absoluto estável pra usar
aqui, e o próprio S7comm pode nem aceitar esse modo de endereçamento para
um DB otimizado.

Estratégia de leitura: as tags são agrupadas por número de DB. Se todas as
tags de um DB cabem dentro de uma faixa de bytes razoável (span <=
MAX_BLOCK_READ_BYTES — o caso comum de um array grande e denso, tipo 4000
elementos sequenciais), o driver faz UMA ÚNICA leitura cobrindo o bloco
inteiro e fatia os valores em memória, em vez de uma requisição por tag.
Se o layout de endereços daquele DB for espalhado demais, volta pro modo
tag a tag.

Isolamento por DB: um DB com endereçamento inválido (ex: acesso otimizado
ligado) pode fazer a CPU resetar a sessão inteira — diferente do CIP
(Rockwell), que devolve um erro elegante por tag sem derrubar nada. Pra
isso não tirar do ar as outras DBs saudáveis do mesmo CLP, cada DB que
falha algumas vezes seguidas entra em "quarentena" por um tempo: o driver
para de tentar ler ESSA DB especificamente, reconecta se preciso, e segue
lendo normalmente as outras.
"""
import logging
import re
import time
from collections import defaultdict
from typing import Any, Dict, List

import snap7
from snap7.util import get_bool, get_dint, get_dword, get_int, get_real

from .base import BaseDriver

logger = logging.getLogger("wtecc.driver.siemens")

_ADDR_RE = re.compile(
    r"DB(?P<db>\d+),DB(?P<kind>[XBWD])(?P<offset>\d+)(?:\.(?P<bit>\d+))?",
    re.IGNORECASE,
)

_FIELD_WIDTH = {"X": 1, "B": 1, "W": 2, "D": 4}

# Acima disso, não compensa ler o DB inteiro num bloco só (evita pedir um
# bloco gigante por causa de um layout de endereços muito espalhado).
MAX_BLOCK_READ_BYTES = 65536

# Depois de falhar essa quantidade de vezes SEGUIDAS, o DB entra em
# quarentena — o driver para de tentar ler ele por um tempo, em vez de
# reconectar a cada ciclo só por causa de uma DB permanentemente ruim.
DB_FAILURE_THRESHOLD = 3
DB_QUARANTINE_SECONDS = 300  # 5 minutos


class SiemensS7Driver(BaseDriver):
    def __init__(self, plc_config: dict):
        super().__init__(plc_config)
        self._rack = plc_config.get("rack") or 0
        self._slot = plc_config.get("slot") or 1
        self._client: snap7.client.Client | None = None
        self._db_failures: Dict[int, int] = {}
        self._db_quarantined_until: Dict[int, float] = {}
        # Guarda contra leitura rasgada (torn read): se configurado em
        # extra_config -> "torn_read_guard_threshold" (número), qualquer
        # valor numérico que varie mais que esse limiar desde a última
        # leitura confirmada é considerado suspeito e é RE-LIDO na hora,
        # isolado, antes de aceitar — o valor rasgado (que existiu só um
        # instante, no meio de uma escrita do CLP) não sobrevive a uma
        # segunda leitura milissegundos depois. Desligado por padrão (None)
        # pra não mascarar mudanças legítimas em tags que naturalmente
        # variam bastante — é uma decisão por CLP, não automática.
        threshold = (plc_config.get("extra_config") or {}).get("torn_read_guard_threshold")
        self._torn_read_guard_threshold: float | None = (
            float(threshold) if threshold is not None else None
        )
        self._last_known_value: Dict[int, float] = {}

    def connect(self) -> bool:
        try:
            self._client = snap7.client.Client()
            self._client.connect(self.ip, self._rack, self._slot)
            connected = self._client.get_connected()
            if connected:
                # Limita quanto tempo uma leitura pode ficar esperando resposta.
                # Sem isso, um pico de latência de rede (sem erro nenhum, só
                # lento) faz o db_read() bloquear em silêncio por 1s+ — tempo
                # suficiente pra perder um valor real da fonte entre uma
                # leitura e outra. Com o timeout, essa espera vira uma
                # exceção (capturada pelo retry que já existe) em vez de um
                # bloqueio silencioso. Escalado com o scan configurado (3x,
                # entre 300ms e 2s) — folgado o bastante pra não gerar falso
                # positivo em variação normal de rede.
                poll_ms = self.plc_config.get("poll_interval_ms") or 1000
                timeout_ms = int(max(min(poll_ms * 3, 2000), 300))
                try:
                    self._client.set_timeout(timeout_ms)
                except Exception as exc:
                    logger.warning(
                        "Não foi possível configurar timeout (%dms) no cliente S7 de %s "
                        "(%s: %s) — seguindo com o padrão da biblioteca.",
                        timeout_ms, self.name, type(exc).__name__, exc,
                    )
            return connected
        except Exception as exc:
            logger.error("Falha ao conectar em %s (%s): %s", self.name, self.ip, exc)
            return False

    def disconnect(self) -> None:
        if self._client:
            self._client.disconnect()

    @property
    def is_connected(self) -> bool:
        return bool(self._client and self._client.get_connected())

    def _verify_if_suspicious(self, tag: dict, value: Any, db: int, offset: int, width: int, kind: str, bit: int) -> Any:
        """
        Guarda contra leitura rasgada: se o valor decodificado desviar mais
        que o limiar configurado do último valor confirmado dessa tag,
        re-lê SÓ essa tag, isolada, na hora — um torn read é um estado que
        existiu por um instante só durante uma escrita do CLP; uma segunda
        leitura milissegundos depois praticamente sempre pega o valor real
        já assentado. Só se aplica a tipos numéricos (int/dint/real) e só
        quando torn_read_guard_threshold está configurado nesse CLP.
        """
        if self._torn_read_guard_threshold is None or tag["data_type"] not in ("int", "dint", "real"):
            return value

        tag_id = tag["id"]
        last = self._last_known_value.get(tag_id)
        if last is not None and abs(float(value) - last) > self._torn_read_guard_threshold:
            try:
                raw = self._client.db_read(db, offset, width)
                reread_value = self._decode(raw, 0, kind, bit, tag["data_type"])
                if reread_value != value:
                    logger.warning(
                        "Guarda contra leitura rasgada: %s em %s leu %s, releitura deu %s "
                        "(desvio > %s do último valor confirmado %s) — usando a releitura.",
                        tag["address"], self.name, value, reread_value,
                        self._torn_read_guard_threshold, last,
                    )
                    value = reread_value
            except Exception as exc:
                logger.warning(
                    "Falha na releitura de verificação de %s em %s: %s — mantendo valor original.",
                    tag["address"], self.name, exc,
                )

        self._last_known_value[tag_id] = float(value)
        return value

    def _decode(self, data, rel: int, kind: str, bit: int, data_type: str) -> Any:
        if kind == "X":
            return get_bool(data, rel, bit)
        if kind == "W":
            return get_int(data, rel)
        if kind == "D":
            if data_type == "real":
                return get_real(data, rel)
            if data_type == "dint":
                return get_dint(data, rel)
            return get_dword(data, rel)
        if kind == "B":
            return data[rel]
        raise ValueError(f"tipo de campo desconhecido: {kind}")

    def _on_db_read_failure(self, db: int, exc: Exception) -> None:
        count = self._db_failures.get(db, 0) + 1
        self._db_failures[db] = count
        logger.error(
            "Falha lendo DB%d em %s (tentativa %d/%d): %s",
            db, self.name, count, DB_FAILURE_THRESHOLD, exc,
        )
        if count >= DB_FAILURE_THRESHOLD:
            self._db_quarantined_until[db] = time.monotonic() + DB_QUARANTINE_SECONDS
            logger.error(
                "DB%d em %s falhou %d vezes seguidas — pausando a leitura dessa DB "
                "por %ds (as outras DBs desse CLP continuam normalmente). Causa comum: "
                "'Optimized block access' habilitado nessa DB no TIA Portal.",
                db, self.name, count, DB_QUARANTINE_SECONDS,
            )
        # a sessão pode ter quebrado de verdade (a CPU às vezes reseta a
        # conexão inteira num endereço inválido) — marca pra reconectar,
        # mas sem abandonar as outras DBs deste ciclo.
        self._client = None

    def read_tags(self, tags: List[dict]) -> Dict[int, Any]:
        if not self.is_connected:
            return {}

        parsed = []
        for t in tags:
            match = _ADDR_RE.match(t["address"].strip())
            if not match:
                logger.warning("Endereço inválido para Siemens: %s", t["address"])
                continue
            parsed.append((
                t,
                int(match["db"]),
                match["kind"].upper(),
                int(match["offset"]),
                int(match["bit"]) if match["bit"] else 0,
            ))

        by_db: Dict[int, list] = defaultdict(list)
        for item in parsed:
            by_db[item[1]].append(item)

        results: Dict[int, Any] = {}
        now = time.monotonic()

        for db, items in by_db.items():
            quarantined_until = self._db_quarantined_until.get(db)
            if quarantined_until is not None:
                if now < quarantined_until:
                    continue  # ainda em quarentena, nem tenta
                del self._db_quarantined_until[db]  # cooldown acabou, tenta de novo

            # a conexão pode ter caído por causa de uma DB anterior neste
            # mesmo ciclo — reconecta antes de seguir pras próximas DBs em
            # vez de abandonar o ciclo inteiro
            if not self.is_connected:
                if not self.connect():
                    break  # sem conexão, não adianta tentar as demais DBs agora

            lo = min(offset for _, _, _, offset, _ in items)
            hi = max(offset + _FIELD_WIDTH[kind] for _, _, kind, offset, _ in items)
            span = hi - lo

            if span <= MAX_BLOCK_READ_BYTES:
                # --- leitura em bloco: uma requisição cobre o DB inteiro ---
                # Uma falha isolada (jitter momentâneo de rede) não precisa
                # forçar reconexão na hora — tenta mais UMA vez, imediata,
                # na MESMA conexão, antes de desistir. Isso evita perder um
                # valor intermediário (ex: contador pulando de 60747 pra
                # 60749) só porque a primeira tentativa esbarrou num
                # pacote perdido — o handshake de reconexão demora mais
                # que um ciclo inteiro, e é durante essa demora que um
                # valor real do CLP pode passar batido.
                data = None
                last_exc = None
                for attempt in range(2):
                    try:
                        data = self._client.db_read(db, lo, span)
                        last_exc = None
                        break
                    except Exception as exc:
                        last_exc = exc
                        if attempt == 0:
                            continue  # tenta mais uma vez, na hora, sem reconectar

                if data is None:
                    self._on_db_read_failure(db, last_exc)
                    continue  # outras DBs deste ciclo continuam normalmente

                self._db_failures[db] = 0  # sucesso: zera o contador de falhas dessa DB

                for t, _, kind, offset, bit in items:
                    try:
                        value = self._decode(data, offset - lo, kind, bit, t["data_type"])
                        value = self._verify_if_suspicious(
                            t, value, db, offset, _FIELD_WIDTH[kind], kind, bit
                        )
                        results[t["id"]] = value
                    except Exception as exc:
                        logger.error("Falha decodificando %s em %s: %s", t["address"], self.name, exc)
            else:
                # --- layout espalhado demais: volta pro tag a tag ---
                logger.warning(
                    "DB%d em %s tem %d tags espalhadas em %d bytes (> %d) — lendo tag a tag, "
                    "considere revisar o layout de endereços para permitir leitura em bloco.",
                    db, self.name, len(items), span, MAX_BLOCK_READ_BYTES,
                )
                db_failed = False
                for t, _, kind, offset, bit in items:
                    if not self.is_connected:
                        if not self.connect():
                            db_failed = True
                            break
                    try:
                        width = _FIELD_WIDTH[kind]
                        raw = self._client.db_read(db, offset, width)
                        results[t["id"]] = self._decode(raw, 0, kind, bit, t["data_type"])
                    except Exception as exc:
                        self._on_db_read_failure(db, exc)
                        db_failed = True
                        break  # essa DB específica falhou, mas o loop externo segue pras outras
                if not db_failed:
                    self._db_failures[db] = 0

        return results
