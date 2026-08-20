import os

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import require_role

router = APIRouter(prefix="/storage", tags=["Armazenamento"])

# Igual ao coletor: InfluxDB é OPCIONAL aqui também. Enquanto não estiver
# configurado (ou durante a migração, com os dois bancos ainda ativos),
# essa rota cai de volta pras consultas antigas no Postgres/Timescale.
INFLUXDB_HOST = os.getenv("INFLUXDB_HOST")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN")
INFLUXDB_DATABASE = os.getenv("INFLUXDB_DATABASE", "wtecc_historian")

_influx_client = None
if INFLUXDB_HOST:
    from influxdb_client_3 import InfluxDBClient3
    _influx_client = InfluxDBClient3(host=INFLUXDB_HOST, token=INFLUXDB_TOKEN, database=INFLUXDB_DATABASE)


def _tag_events_stats_from_influx() -> dict:
    """Conta linhas e período coberto do histórico direto no InfluxDB."""
    result = _influx_client.query(
        query="SELECT count(*) AS row_count, min(time) AS oldest, max(time) AS newest FROM tag_events",
        language="sql",
    )
    row = result.to_pylist()[0] if result.num_rows > 0 else {}

    events_24h_result = _influx_client.query(
        query="SELECT count(*) AS c FROM tag_events WHERE time > now() - INTERVAL '24 hours'",
        language="sql",
    )
    events_24h_row = events_24h_result.to_pylist()[0] if events_24h_result.num_rows > 0 else {}

    return {
        "approximate_row_count": int(row.get("row_count") or 0),
        "events_last_24h": int(events_24h_row.get("c") or 0),
        # Tamanho em disco e compressão são conceitos específicos do
        # Timescale (hypertable/chunks) — não têm equivalente direto e
        # simples via SQL no InfluxDB 3, então ficam None nesse modo. Se
        # precisar disso de volta, dá pra consultar via `influxdb3
        # show system table parquet_files` — fora do escopo desse endpoint
        # por ora.
        "hypertable_size_bytes": None,
        "oldest_event_at": row.get("oldest"),
        "newest_event_at": row.get("newest"),
        "total_chunks": None,
        "compressed_chunks": None,
        "compression_ratio": None,
    }


def _tag_events_stats_from_postgres(db: Session) -> dict:
    """Comportamento original — Postgres/TimescaleDB."""
    row_count = db.execute(
        text("SELECT approximate_row_count('tag_events')")
    ).scalar() or 0

    events_24h = db.execute(
        text("SELECT count(*) FROM tag_events WHERE time > now() - interval '24 hours'")
    ).scalar() or 0

    size_bytes = db.execute(text("SELECT hypertable_size('tag_events')")).scalar() or 0

    date_range = db.execute(
        text("SELECT min(time) AS oldest, max(time) AS newest FROM tag_events")
    ).mappings().first()

    compression = db.execute(
        text("SELECT * FROM hypertable_compression_stats('tag_events')")
    ).mappings().first()

    total_chunks = (compression or {}).get("total_chunks") or 0
    compressed_chunks = (compression or {}).get("number_compressed_chunks") or 0
    before_bytes = (compression or {}).get("before_compression_total_bytes")
    after_bytes = (compression or {}).get("after_compression_total_bytes")
    compression_ratio = (
        round(before_bytes / after_bytes, 2)
        if before_bytes and after_bytes and after_bytes > 0
        else None
    )

    return {
        "approximate_row_count": int(row_count),
        "events_last_24h": int(events_24h),
        "hypertable_size_bytes": int(size_bytes),
        "oldest_event_at": date_range["oldest"] if date_range else None,
        "newest_event_at": date_range["newest"] if date_range else None,
        "total_chunks": int(total_chunks),
        "compressed_chunks": int(compressed_chunks),
        "compression_ratio": compression_ratio,
    }


@router.get("/stats")
def get_storage_stats(db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    """
    Métricas de uso pra tela de armazenamento do frontend. O histórico de
    valores (tag_events) vem do InfluxDB quando configurado (arquitetura
    híbrida); cadastro de CLPs/tags continua sempre vindo do Postgres,
    que é onde ele mora — não migrou.
    """
    if _influx_client is not None:
        try:
            event_stats = _tag_events_stats_from_influx()
        except Exception:
            # Se o InfluxDB estiver fora do ar, não derruba a tela inteira
            # — volta pro Postgres, que continua tendo os dados até a
            # migração estar 100% concluída e a gravação dupla ser desligada.
            event_stats = _tag_events_stats_from_postgres(db)
    else:
        event_stats = _tag_events_stats_from_postgres(db)

    plc_count = db.execute(text("SELECT count(*) FROM plcs")).scalar() or 0
    enabled_plc_count = db.execute(text("SELECT count(*) FROM plcs WHERE enabled")).scalar() or 0
    tag_count = db.execute(text("SELECT count(*) FROM tags")).scalar() or 0
    enabled_tag_count = db.execute(text("SELECT count(*) FROM tags WHERE enabled")).scalar() or 0

    return {
        **event_stats,
        "plc_count": int(plc_count),
        "enabled_plc_count": int(enabled_plc_count),
        "tag_count": int(tag_count),
        "enabled_tag_count": int(enabled_tag_count),
    }
