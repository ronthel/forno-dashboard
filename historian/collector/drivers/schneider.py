"""
Driver Schneider via Modbus TCP (pymodbus), usado para linhas M221/M241/M251/M580
que expõem Modbus. Para linhas Premium/Quantum com Unity (protocolo UMAS),
uma biblioteca dedicada seria necessária — este driver cobre o caso Modbus,
que é o mais comum e mais estável de se integrar.

Endereçamento esperado no campo `address`:
  "40001"  -> holding register 1 (word)
  "00001"  -> coil 1 (bool)
  "30001"  -> input register 1 (word, somente leitura)
"""
import logging
from typing import Any, Dict, List

from pymodbus.client import ModbusTcpClient

from .base import BaseDriver

logger = logging.getLogger("wtecc.driver.schneider")


class SchneiderModbusDriver(BaseDriver):
    def __init__(self, plc_config: dict):
        super().__init__(plc_config)
        self._port = plc_config.get("port") or 502
        self._client: ModbusTcpClient | None = None

    def connect(self) -> bool:
        try:
            self._client = ModbusTcpClient(self.ip, port=self._port)
            return self._client.connect()
        except Exception as exc:
            logger.error("Falha ao conectar em %s (%s): %s", self.name, self.ip, exc)
            return False

    def disconnect(self) -> None:
        if self._client:
            self._client.close()

    @property
    def is_connected(self) -> bool:
        return bool(self._client and self._client.connected)

    def read_tags(self, tags: List[dict]) -> Dict[int, Any]:
        if not self.is_connected:
            return {}

        results: Dict[int, Any] = {}
        for t in tags:
            addr = t["address"].strip()
            try:
                if addr.startswith("4"):  # holding register
                    reg = int(addr[1:]) - 1
                    rr = self._client.read_holding_registers(reg, 1)
                    if rr.isError():
                        continue
                    results[t["id"]] = rr.registers[0]
                elif addr.startswith("0"):  # coil
                    reg = int(addr[1:]) - 1
                    rr = self._client.read_coils(reg, 1)
                    if rr.isError():
                        continue
                    results[t["id"]] = rr.bits[0]
                elif addr.startswith("3"):  # input register
                    reg = int(addr[1:]) - 1
                    rr = self._client.read_input_registers(reg, 1)
                    if rr.isError():
                        continue
                    results[t["id"]] = rr.registers[0]
                else:
                    logger.warning("Endereço Modbus não reconhecido: %s", addr)
            except Exception as exc:
                logger.error("Falha lendo %s em %s: %s", addr, self.name, exc)

        return results
