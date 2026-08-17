"""
tray_status.py — Ícone de bandeja com status do pipeline PLC -> InfluxDB
(Projeto Parati)

Fica na bandeja do Windows e muda de cor conforme a "saúde" do pipeline:
  - Verde:   houve escrita recente no InfluxDB (pipeline rodando normal)
  - Vermelho: não há escrita recente (pipeline parado/travado)
  - Cinza:   não conseguiu nem consultar o InfluxDB

Este script NÃO lê o PLC nem escreve no InfluxDB — ele só monitora,
consultando periodicamente o último registro gravado. Quem grava de
fato continua sendo o plc_to_influx.py (rodando manual ou como serviço
NSSM).

IMPORTANTE: isso precisa rodar na sessão gráfica do usuário (não dá
pra rodar como serviço NSSM, porque serviço não tem acesso à área de
trabalho/bandeja). Ver instruções de "iniciar junto com o Windows" no
final deste arquivo.

Uso manual:
    python tray_status.py

Uso sem janela de console (recomendado no dia a dia):
    C:\\Projetos\\forno-dashboard\\plc-service\\venv\\Scripts\\pythonw.exe C:\\Projetos\\forno-dashboard\\plc-service\\tray_status.py
"""

import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler

import requests
import pystray
from dotenv import load_dotenv
from PIL import Image, ImageDraw

# Carrega o .env desta pasta (plc-service/.env) antes de ler qualquer
# variável de ambiente abaixo.
load_dotenv()

_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)

_log_handlers = [
    RotatingFileHandler(
        os.path.join(_LOG_DIR, "tray_status.log"),
        maxBytes=1_000_000,
        backupCount=2,
        encoding="utf-8",
    )
]
# Rodando via pythonw.exe não existe console (sys.stderr é None) — só
# adiciona saída de console se houver uma de verdade.
if sys.stderr is not None:
    _log_handlers.append(logging.StreamHandler())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)
log = logging.getLogger("tray_status")

# ---------------------------------------------------------------------------
# CONFIGURAÇÃO — token/URL/bucket vêm do .env desta pasta (mesmos valores já
# preenchidos para o plc_to_influx.py, já que os dois usam o mesmo InfluxDB).
# ---------------------------------------------------------------------------
INFLUX_URL = os.environ.get("INFLUX_URL", "http://127.0.0.1:8181")
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "forno")
INFLUX_MEASUREMENT = "Variaveis"

if not INFLUX_TOKEN:
    log.warning(
        "INFLUX_TOKEN não definido no .env — as consultas ao InfluxDB vão "
        "falhar até isso ser configurado."
    )

# Considera "OK" se houve escrita nos últimos N segundos.
# Sugestão: uns 4-6x o POLL_INTERVAL_SECONDS do plc_to_influx.py.
FRESHNESS_THRESHOLD_SECONDS = 30

# Intervalo entre checagens do ícone.
CHECK_INTERVAL_SECONDS = 10

# ---------------------------------------------------------------------------

STATUS_OK = "ok"
STATUS_STALE = "stale"
STATUS_ERROR = "error"

COLORS = {
    STATUS_OK: (46, 160, 67, 255),      # verde
    STATUS_STALE: (217, 48, 37, 255),   # vermelho
    STATUS_ERROR: (130, 130, 130, 255), # cinza
}

TOOLTIPS = {
    STATUS_OK: "Parati — pipeline OK",
    STATUS_STALE: "Parati — sem escrita recente no InfluxDB (verifique o script)",
    STATUS_ERROR: "Parati — não foi possível consultar o InfluxDB",
}


def make_icon_image(color):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((8, 8, 56, 56), fill=color, outline=(255, 255, 255, 255), width=3)
    return img


def _parse_influx_time(time_str: str) -> datetime:
    """Converte o timestamp retornado pelo InfluxDB (ex.:
    '2026-07-31T18:47:59.115730600', em nanossegundos e sem 'Z') para um
    datetime timezone-aware em UTC."""
    if "." in time_str:
        date_part, frac = time_str.split(".")
        # trunca a fração de segundos para 6 dígitos (microssegundos),
        # já que o Python não interpreta nanossegundos diretamente
        frac = (frac + "000000")[:6]
        time_str = f"{date_part}.{frac}"
    return datetime.fromisoformat(time_str).replace(tzinfo=timezone.utc)


def query_last_write_age_seconds() -> float:
    """Consulta o InfluxDB e retorna há quantos segundos foi feita a
    última escrita na measurement configurada."""
    url = f"{INFLUX_URL}/api/v3/query_sql"
    headers = {
        "Authorization": f"Bearer {INFLUX_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "db": INFLUX_BUCKET,
        "q": f'SELECT * FROM "{INFLUX_MEASUREMENT}" ORDER BY time DESC LIMIT 1',
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=5)
    resp.raise_for_status()
    data = resp.json()

    # A API pode devolver uma lista solta ([{...}]) ou, em algumas
    # respostas, um objeto com a lista dentro de "value". Aceita os dois.
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = data.get("value", [])
    else:
        rows = []

    if not rows:
        raise ValueError("Nenhum registro encontrado na measurement.")

    last_time = _parse_influx_time(rows[0]["time"])
    now = datetime.now(timezone.utc)
    return (now - last_time).total_seconds()


def monitor_loop(icon: "pystray.Icon"):
    while True:
        try:
            age = query_last_write_age_seconds()
            status = STATUS_OK if age <= FRESHNESS_THRESHOLD_SECONDS else STATUS_STALE
            log.info("Consulta OK. Última escrita há %.1fs (status=%s)", age, status)
        except Exception as exc:
            status = STATUS_ERROR
            log.error("Falha ao consultar InfluxDB: %r", exc)

        icon.icon = make_icon_image(COLORS[status])
        icon.title = TOOLTIPS[status]

        time.sleep(CHECK_INTERVAL_SECONDS)


def on_quit(icon, item):
    icon.stop()


def main():
    icon = pystray.Icon(
        "parati_status",
        make_icon_image(COLORS[STATUS_ERROR]),
        TOOLTIPS[STATUS_ERROR],
        menu=pystray.Menu(pystray.MenuItem("Sair", on_quit)),
    )

    threading.Thread(target=monitor_loop, args=(icon,), daemon=True).start()
    icon.run()


if __name__ == "__main__":
    main()
