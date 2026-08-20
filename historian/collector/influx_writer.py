"""
Escrita do histórico de valores (tag_events) no InfluxDB 3 — parte
"série temporal" da arquitetura híbrida. O cadastro (plcs, tags) e o
estado operacional (tag_last_value, tag_status, plc_status) CONTINUAM no
Postgres — só o histórico de valores, que é o volume alto e cresce sem
parar, migra pra cá.

Desenho do schema no InfluxDB:
  measurement: "tag_events"
  tags (indexado, string)  : tag_id, plc_id, tag_name
  fields                   : value_bool (bool), value_num (float),
                              value_str (string), quality (string)
  timestamp                : o instante real da leitura (mesmo que hoje)

`tag_name` e `plc_id` são gravados de propósito, mesmo sendo redundantes
com o que já está no Postgres — o InfluxDB não faz JOIN relacional com
outra base, então os dashboards que hoje fazem JOIN tag_events + tags
precisam desse dado já embutido em cada ponto pra funcionar sem depender
de consultar o Postgres a cada gráfico.
"""
import logging
import threading
import time
from typing import Any, Dict, List

from influxdb_client_3 import InfluxDBClient3, Point

logger = logging.getLogger("wtecc.collector.influx")


class InfluxWriteBuffer:
    """
    Mesmo padrão da WriteBuffer do Postgres (acumula em memória, grava em
    lote periodicamente) — só que escrevendo no InfluxDB em vez de
    tag_events do Postgres. Pensada pra ser preenchida pelas MESMAS
    chamadas que hoje alimentam a WriteBuffer, então basta um `.add()` a
    mais no ponto onde o coletor já decide "isso deve ser gravado".
    """

    def __init__(self, host: str, token: str, database: str):
        self._client = InfluxDBClient3(host=host, token=token, database=database)
        self._lock = threading.Lock()
        self._rows: List[dict] = []

    def add(self, tag_id: int, plc_id: int, tag_name: str, value: Any, data_type: str,
            quality: str = "good", time=None):
        row = {
            "tag_id": tag_id,
            "plc_id": plc_id,
            "tag_name": tag_name,
            "value_bool": bool(value) if data_type == "bool" else None,
            "value_num": float(value) if data_type in ("int", "dint", "real") else None,
            "value_str": str(value) if data_type == "string" else None,
            "quality": quality,
            "time": time,
        }
        with self._lock:
            self._rows.append(row)

    def flush(self):
        with self._lock:
            rows, self._rows = self._rows, []
        if not rows:
            return

        points = []
        for r in rows:
            p = (
                Point("tag_events")
                .tag("tag_id", str(r["tag_id"]))
                .tag("plc_id", str(r["plc_id"]))
                .tag("tag_name", r["tag_name"])
                .field("quality", r["quality"])
            )
            if r["value_bool"] is not None:
                p = p.field("value_bool", r["value_bool"])
            if r["value_num"] is not None:
                p = p.field("value_num", r["value_num"])
            if r["value_str"] is not None:
                p = p.field("value_str", r["value_str"])
            if r["time"] is not None:
                p = p.time(r["time"])
            points.append(p)

        try:
            self._client.write(points)
        except Exception:
            logger.exception("Falha ao gravar %d pontos no InfluxDB — lote perdido.", len(points))

    def close(self):
        self._client.close()


def influx_flush_loop(influx_buffer: "InfluxWriteBuffer", interval_s: float):
    """
    Roda em thread própria, separada do flush_loop do Postgres — assim
    uma eventual lentidão do InfluxDB não atrasa a gravação de
    tag_last_value/status no Postgres, e vice-versa.
    """
    while True:
        time.sleep(interval_s)
        influx_buffer.flush()
