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

Quais tags são lidas do PLC:
  A lista de tags monitoradas NÃO é mais fixa no código — vem do arquivo
  "monitored_tags.json" nesta mesma pasta (criado automaticamente na 1ª
  execução, com a lista que já era usada antes desta mudança). O backend
  do dashboard (tela de Variáveis) reescreve esse arquivo sempre que uma
  variável é criada/desativada/reativada, e este script relê o arquivo
  periodicamente — não precisa reiniciar o pipeline a cada mudança.

  Também é exposta uma pequena API HTTP local (só em 127.0.0.1, nunca
  acessível de fora) em /tags, que devolve todas as tags disponíveis no
  controlador (reaproveitando a mesma conexão já aberta com o PLC — não
  abre uma segunda conexão concorrente). O backend do dashboard consulta
  essa API para alimentar o seletor de variáveis da tela de configuração.
"""

import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

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

# Intervalo entre leituras, em segundos.
POLL_INTERVAL_SECONDS = 5

# Watchdog: se ficar mais do que isso sem completar um ciclo de leitura,
# assume que a conexão CIP travou (sem erro) e força o processo a reiniciar.
# Precisa ser bem maior que POLL_INTERVAL_SECONDS.
WATCHDOG_TIMEOUT_SECONDS = max(30, POLL_INTERVAL_SECONDS * 6)

# Arquivo com a lista de tags a monitorar (ver docstring acima).
TAGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "monitored_tags.json")

# A cada quantos ciclos de leitura verifica se monitored_tags.json mudou
# (barato — só olha a data de modificação do arquivo, não reabre nada).
TAGS_RELOAD_EVERY_N_CYCLES = 6  # ~30s com POLL_INTERVAL_SECONDS=5

# Porta da API local de descoberta de tags (só 127.0.0.1). Pode ser
# sobrescrita via variável de ambiente se a porta padrão já estiver em uso.
LOCAL_API_PORT = int(os.environ.get("PLC_SERVICE_API_PORT", "8787"))

# Lista de tags monitoradas usada caso monitored_tags.json ainda não exista
# (1ª execução) — é a mesma lista que era fixa no código antes desta mudança,
# então quem já estava rodando não perde nenhuma variável na migração.
DEFAULT_TAGS = [
    "CTP01", "CTP02", "CTP03", "CTP04", "CTP05", "CTP06",
    "CTQ", "CTC", "CTV", "RUN_TIME_SEC", "TOTAL_COUNT", "GOOD_COUNT", "ALARM_COUNT",
]

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

# Lista de tags monitoradas no momento (protegida por lock — lida pelo loop
# principal, escrita pelo próprio loop quando monitored_tags.json muda).
_tags_lock = threading.Lock()
_current_tags = list(DEFAULT_TAGS)
_tags_file_mtime = None

# Cache com a última descoberta de tags do controlador (atualizado a cada
# reconexão bem-sucedida com o PLC). Servido pela API local em /tags.
_discovered_tags_cache = {"total": 0, "atomic_scalar": [], "others": [], "updated_at": None}


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


# --- Lista de tags monitoradas (dinâmica, via monitored_tags.json) --------

def _load_monitored_tags_from_disk():
    """Lê monitored_tags.json do disco. Cria o arquivo com a lista padrão se
    ainda não existir (1ª execução). Em caso de erro/formato inválido, cai
    de volta pra lista padrão em vez de derrubar o pipeline."""
    if not os.path.exists(TAGS_FILE):
        try:
            with open(TAGS_FILE, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_TAGS, f, ensure_ascii=False, indent=2)
        except Exception as exc:
            log.error("Não consegui criar monitored_tags.json: %s. Usando lista padrão em memória.", exc)
        return list(DEFAULT_TAGS)

    try:
        with open(TAGS_FILE, "r", encoding="utf-8") as f:
            tags = json.load(f)
        if isinstance(tags, list) and all(isinstance(t, str) for t in tags) and len(tags) > 0:
            return tags
        log.warning("monitored_tags.json vazio ou em formato inesperado — usando lista padrão.")
        return list(DEFAULT_TAGS)
    except Exception as exc:
        log.error("Falha ao ler monitored_tags.json (%s) — usando lista padrão.", exc)
        return list(DEFAULT_TAGS)


def get_current_tags():
    with _tags_lock:
        return list(_current_tags)


def maybe_reload_tags():
    """Chamado periodicamente pelo loop principal — só relê o arquivo do
    disco se a data de modificação mudou desde a última checagem (barato:
    um único os.path.getmtime por chamada)."""
    global _tags_file_mtime, _current_tags
    try:
        mtime = os.path.getmtime(TAGS_FILE)
    except OSError:
        return

    if _tags_file_mtime is None:
        _tags_file_mtime = mtime
        return

    if mtime != _tags_file_mtime:
        _tags_file_mtime = mtime
        new_tags = _load_monitored_tags_from_disk()
        with _tags_lock:
            _current_tags = new_tags
        log.info("monitored_tags.json mudou — lista de tags monitoradas atualizada: %s", ", ".join(new_tags))


# --- Descoberta de tags do controlador (para a API local /tags) -----------

def _is_struct_tag(tag_info: dict) -> bool:
    return isinstance(tag_info.get("data_type"), dict)


def _tag_data_type_label(tag_info: dict) -> str:
    data_type = tag_info.get("data_type")
    if isinstance(data_type, dict):
        return str(data_type.get("name", "estrutura"))
    return str(data_type)


def update_discovered_tags_cache(plc: LogixDriver):
    """Classifica plc.tags em 'atomic_scalar' (candidatas a monitorar) e
    'others' (estruturas/arrays/UDTs), igual ao teste_plc.py, e guarda no
    cache servido pela API local. Chamado uma vez a cada reconexão bem
    sucedida com o PLC (a lista de tags do controlador raramente muda em
    tempo real)."""
    all_tags = plc.tags or {}
    atomic_scalar = []
    others = []
    for name, info in all_tags.items():
        try:
            dim = info.get("dim", 0) or 0
            entry = {
                "tag_name": name,
                "data_type": _tag_data_type_label(info),
                "dim": dim,
            }
            if not _is_struct_tag(info) and dim == 0:
                atomic_scalar.append(entry)
            else:
                others.append(entry)
        except Exception:
            continue

    atomic_scalar.sort(key=lambda t: t["tag_name"])
    others.sort(key=lambda t: t["tag_name"])

    with _tags_lock:
        _discovered_tags_cache["total"] = len(all_tags)
        _discovered_tags_cache["atomic_scalar"] = atomic_scalar
        _discovered_tags_cache["others"] = others
        _discovered_tags_cache["updated_at"] = time.time()

    log.info(
        "Descoberta de tags do PLC atualizada: %d no total, %d atomicas candidatas.",
        len(all_tags), len(atomic_scalar),
    )


# --- API HTTP local (só 127.0.0.1) — descoberta de tags para o dashboard --

class _LocalApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 (nome exigido pela classe base)
        # Não polui o log principal com uma linha por requisição HTTP.
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/tags":
            with _tags_lock:
                payload = dict(_discovered_tags_cache)
            self._send_json(payload)
        elif self.path == "/monitored-tags":
            self._send_json({"tags": get_current_tags()})
        elif self.path == "/health":
            self._send_json({"status": "ok"})
        else:
            self._send_json({"error": "not found"}, status=404)


def start_local_api():
    try:
        server = HTTPServer(("127.0.0.1", LOCAL_API_PORT), _LocalApiHandler)
    except OSError as exc:
        log.error(
            "Não consegui abrir a API local na porta %s (%s). O seletor de "
            "variáveis do dashboard não vai conseguir listar as tags do PLC, "
            "mas a gravação no InfluxDB continua normalmente.",
            LOCAL_API_PORT, exc,
        )
        return
    log.info("API local de descoberta de tags em http://127.0.0.1:%s (/tags, /monitored-tags)", LOCAL_API_PORT)
    server.serve_forever()


# --- Leitura do PLC / escrita no InfluxDB (fluxo principal) ---------------

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


def read_plc(plc: LogixDriver, tags: list) -> dict:
    """Lê as TAGS informadas (lista de nomes) e retorna um dict {tag: valor}."""
    if not tags:
        return {}

    results = plc.read(*tags)

    # plc.read com múltiplas tags retorna uma lista de objetos de resultado;
    # com uma única tag retorna o objeto direto. Normaliza para lista.
    if not isinstance(results, list):
        results = [results]

    readings = {}
    for tag_name, result in zip(tags, results):
        if result is not None and getattr(result, "error", None) is None:
            readings[tag_name] = result.value
        else:
            error = getattr(result, "error", "desconhecido")
            log.warning("Falha ao ler tag %s: %s", tag_name, error)
            readings[tag_name] = None

    return readings


def main():
    global _current_tags, _tags_file_mtime

    with _tags_lock:
        _current_tags = _load_monitored_tags_from_disk()
    try:
        _tags_file_mtime = os.path.getmtime(TAGS_FILE)
    except OSError:
        _tags_file_mtime = None

    log.info("Iniciando pipeline PLC -> InfluxDB")
    log.info("PLC: %s", PLC_PATH)
    log.info("InfluxDB: %s (bucket=%s)", INFLUX_URL, INFLUX_BUCKET)
    log.info("Tags monitoradas (de monitored_tags.json): %s", ", ".join(get_current_tags()))
    log.info("Intervalo de leitura: %ss", POLL_INTERVAL_SECONDS)
    log.info("Watchdog: reinicia se travar > %ss sem erro", WATCHDOG_TIMEOUT_SECONDS)

    threading.Thread(target=watchdog_loop, daemon=True).start()
    threading.Thread(target=start_local_api, daemon=True).start()

    cycle_count = 0

    while True:
        try:
            with LogixDriver(PLC_PATH) as plc:
                log.info("Conectado ao PLC.")
                try:
                    update_discovered_tags_cache(plc)
                except Exception as exc:
                    log.warning("Não consegui atualizar a lista de tags descobertas: %s", exc)
                _beat()

                while True:
                    tags = get_current_tags()
                    readings = read_plc(plc, tags)
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

                    cycle_count += 1
                    if cycle_count % TAGS_RELOAD_EVERY_N_CYCLES == 0:
                        maybe_reload_tags()

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
