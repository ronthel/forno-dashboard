"""
plc_to_influx.py — Piloto Forno (Projeto Parati)

Lê tags do PLC (Logix Echo, via pycomm3) periodicamente e escreve os
valores no InfluxDB 3 Core (via API HTTP, line protocol).

Fluxo: PLC (Logix Echo) -> este script -> InfluxDB 3 Core -> Grafana

Antes de rodar:
  1. Copie ".env.example" para ".env" nesta mesma pasta e preencha
     INFLUX_TOKEN (e INFLUX_URL/INFLUX_BUCKET se forem diferentes do padrão).
  2. Ajuste PLC_PATH abaixo, se necessário (não é segredo, por isso continua
     no código em vez do .env — só mesmo o token é sensível).
  3. Rode primeiro os testes isolados do runbook (FASE 2.1 e 2.2)
  4. Só depois rode este script diretamente: python plc_to_influx.py
"""

import logging
import os
import sys
import threading
import time

import requests
from dotenv import load_dotenv
from pycomm3 import LogixDriver

# Carrega o .env desta pasta (plc-service/.env) antes de ler qualquer
# variável de ambiente abaixo.
load_dotenv()

# ---------------------------------------------------------------------------
# CONFIGURAÇÃO — preencher antes de rodar (ver runbook, FASE 1.4)
# ---------------------------------------------------------------------------

# IP e slot do PLC (Logix Echo). Se o Echo estiver na própria VM, geralmente
# é "127.0.0.1/<slot>", com o slot do processador virtual do Studio 5000.
PLC_PATH = "192.168.15.108/0"

# Token admin do InfluxDB 3 Core (apiv3_...), URL e nome do banco (database) —
# vêm do .env desta pasta, nunca hardcoded no código (mesmo padrão já usado
# no backend Node do dashboard).
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "forno")
# Usar sempre 127.0.0.1, nunca localhost (bug de IPv6).
INFLUX_URL = os.environ.get("INFLUX_URL", "http://127.0.0.1:8181")

# Nome da measurement no InfluxDB.
INFLUX_MEASUREMENT = "Variaveis"

# Tags a ler no PLC (nomes exatos definidos no Logix).
TAGS = [
    "CTP01", "CTP02", "CTP03", "CTP04", "CTP05", "CTP06",
    "CTQ", "CTC", "CTV","RUN_TIME_SEC", "TOTAL_COUNT", "GOOD_COUNT", "ALARM_COUNT"
]

# Intervalo entre leituras, em segundos.
POLL_INTERVAL_SECONDS = 5

# Watchdog: se ficar mais do que isso sem completar um ciclo de leitura,
# assume que a conexão CIP travou (sem erro) e força o processo a reiniciar.
# Precisa ser bem maior que POLL_INTERVAL_SECONDS.
WATCHDOG_TIMEOUT_SECONDS = max(30, POLL_INTERVAL_SECONDS * 6)

# ---------------------------------------------------------------------------
# Fim da configuração — normalmente não precisa mexer daqui pra baixo
# ---------------------------------------------------------------------------

_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)

_log_handlers = []
# Console só funciona se houver um console de verdade (não existe rodando
# via pythonw.exe ou como serviço sem redirecionamento de saída).
if sys.stderr is not None:
    _log_handlers.append(logging.StreamHandler())

from logging.handlers import RotatingFileHandler
_log_handlers.append(
    RotatingFileHandler(
        os.path.join(_LOG_DIR, "plc_to_influx.log"),
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)
log = logging.getLogger("plc_to_influx")

if not INFLUX_TOKEN:
    log.warning(
        "INFLUX_TOKEN não definido no .env — as escritas no InfluxDB vão "
        "falhar até isso ser configurado."
    )

# Timestamp (time.time()) do último ciclo que terminou de fato — atualizado
# pela thread de polling. O watchdog compara contra isso.
_last_heartbeat = time.time()
_heartbeat_lock = threading.Lock()


def _beat():
    global _last_heartbeat
    with _heartbeat_lock:
        _last_heartbeat = time.time()


def _seconds_since_last_beat() -> float:
    with _heartbeat_lock:
        return time.time() - _last_heartbeat


def watchdog_loop():
    """Roda em thread separada. Se o loop principal ficar travado (sem
    completar nenhum ciclo) por tempo demais, mata o processo. Se estiver
    rodando via NSSM (FASE 3), o serviço reinicia sozinho; rodando manual,
    é preciso rodar o script de novo."""
    while True:
        time.sleep(5)
        idle = _seconds_since_last_beat()
        if idle > WATCHDOG_TIMEOUT_SECONDS:
            log.critical(
                "Watchdog: %.0fs sem completar um ciclo de leitura/escrita "
                "(> %ss). Conexão provavelmente travou sem erro. "
                "Encerrando processo para forçar reconexão.",
                idle,
                WATCHDOG_TIMEOUT_SECONDS,
            )
            os._exit(1)


def build_line_protocol(readings: dict) -> str:
    """Monta uma linha no formato line protocol do InfluxDB a partir das
    leituras do PLC. Só inclui campos com valor numérico válido."""
    fields = []
    for tag, value in readings.items():
        if value is None:
            continue
        if isinstance(value, bool):
            fields.append(f"{tag}={'true' if value else 'false'}")
        elif isinstance(value, (int, float)):
            fields.append(f"{tag}={value}")
        else:
            # valores não numéricos são escritos como string
            fields.append(f'{tag}="{value}"')

    if not fields:
        return ""

    return f"{INFLUX_MEASUREMENT} {','.join(fields)}"


def write_to_influx(line: str) -> bool:
    """Escreve uma linha (line protocol) no InfluxDB. Retorna True se ok."""
    url = f"{INFLUX_URL}/api/v2/write"
    params = {"bucket": INFLUX_BUCKET}
    headers = {"Authorization": f"Bearer {INFLUX_TOKEN}"}

    try:
        resp = requests.post(
            url, params=params, headers=headers, data=line, timeout=5
        )
    except requests.RequestException as exc:
        log.error("Falha ao conectar no InfluxDB: %s", exc)
        return False

    if resp.status_code == 204:
        return True

    log.error(
        "InfluxDB retornou status %s: %s", resp.status_code, resp.text
    )
    return False


def read_plc(plc: LogixDriver) -> dict:
    """Lê todas as TAGS configuradas e retorna um dict {tag: valor}."""
    results = plc.read(*TAGS)

    # plc.read com múltiplas tags retorna uma lista de objetos de resultado;
    # com uma única tag retorna o objeto direto. Normaliza para lista.
    if not isinstance(results, list):
        results = [results]

    readings = {}
    for tag_name, result in zip(TAGS, results):
        if result is not None and getattr(result, "error", None) is None:
            readings[tag_name] = result.value
        else:
            error = getattr(result, "error", "desconhecido")
            log.warning("Falha ao ler tag %s: %s", tag_name, error)
            readings[tag_name] = None

    return readings


def main():
    log.info("Iniciando pipeline PLC -> InfluxDB")
    log.info("PLC: %s", PLC_PATH)
    log.info("InfluxDB: %s (bucket=%s)", INFLUX_URL, INFLUX_BUCKET)
    log.info("Tags monitoradas: %s", ", ".join(TAGS))
    log.info("Intervalo de leitura: %ss", POLL_INTERVAL_SECONDS)
    log.info("Watchdog: reinicia se travar > %ss sem erro", WATCHDOG_TIMEOUT_SECONDS)

    threading.Thread(target=watchdog_loop, daemon=True).start()

    while True:
        try:
            with LogixDriver(PLC_PATH) as plc:
                log.info("Conectado ao PLC.")
                _beat()
                while True:
                    readings = read_plc(plc)
                    line = build_line_protocol(readings)

                    if line:
                        ok = write_to_influx(line)
                        if ok:
                            log.info("Escrita OK: %s", readings)
                        else:
                            log.error("Falha na escrita no InfluxDB.")
                    else:
                        log.warning(
                            "Nenhuma leitura válida neste ciclo, nada escrito."
                        )

                    # Marca que o ciclo completou (mesmo que a escrita tenha
                    # falhado) — o watchdog só se preocupa com travamentos
                    # silenciosos, não com falhas já logadas.
                    _beat()

                    time.sleep(POLL_INTERVAL_SECONDS)

        except Exception as exc:
            log.error(
                "Erro de conexão/leitura no PLC: %s. "
                "Tentando reconectar em %ss...",
                exc,
                POLL_INTERVAL_SECONDS,
            )
            _beat()
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Interrompido pelo usuário. Encerrando.")
        sys.exit(0)
