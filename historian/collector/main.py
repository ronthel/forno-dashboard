"""
Wtecc Historian - Collector

Lê a configuração de CLPs e tags direto do Postgres (a mesma base que a API
gerencia), abre uma thread de polling por CLP, aplica o motor de regras de
logging e grava os eventos em lote no TimescaleDB.

A configuração é recarregada periodicamente (RELOAD_INTERVAL_S) para que
CLPs/tags novos criados via API/frontend entrem em operação sem precisar
reiniciar o coletor.
"""
import logging
import os
import threading
import time
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

from drivers import get_driver_class
from engine import LoggingEngine, TagConfig
from influx_writer import InfluxWriteBuffer, influx_flush_loop

load_dotenv()  # lê variáveis de um arquivo .env na pasta de execução, se existir

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("wtecc.collector")

# O pycomm3 loga o próprio traceback completo (duas vezes, com exceção
# encadeada) toda vez que uma tag não resolve — em cima de uma tag
# permanentemente quebrada (ex: endereço errado, ou um teste deliberado
# como "tag que não existe"), isso gera um volume de I/O de log pesado o
# suficiente pra atrapalhar outras threads sob carga. Nosso próprio driver
# já loga uma linha limpa e suficiente pra cada erro (ver rockwell.py) —
# então silenciamos o logger interno do pycomm3, mantendo só o nosso.
logging.getLogger("pycomm3").setLevel(logging.CRITICAL)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://wtecc:wtecc_change_me@localhost:5432/wtecc_historian",
).replace("postgresql+psycopg://", "postgresql://")

RELOAD_INTERVAL_S = int(os.getenv("RELOAD_INTERVAL_S", "30"))
WRITE_BATCH_INTERVAL_S = float(os.getenv("WRITE_BATCH_INTERVAL_S", "1.0"))

# InfluxDB é OPCIONAL — só ativa se INFLUXDB_HOST estiver configurado no
# .env. Sem isso, o coletor continua funcionando 100% igual a antes,
# gravando só no Postgres (arquitetura híbrida: config/estado continuam
# no Postgres pra sempre; tag_events passa a ir pro InfluxDB quando essa
# variável existir).
INFLUXDB_HOST = os.getenv("INFLUXDB_HOST")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN")
INFLUXDB_DATABASE = os.getenv("INFLUXDB_DATABASE", "wtecc_historian")


def get_conn():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


def load_config():
    """Carrega todos os CLPs habilitados e suas tags habilitadas."""
    with get_conn() as conn:
        plcs = conn.execute("SELECT * FROM plcs WHERE enabled = true").fetchall()
        tags = conn.execute("SELECT * FROM tags WHERE enabled = true").fetchall()

    tags_by_plc = {}
    for t in tags:
        tags_by_plc.setdefault(t["plc_id"], []).append(t)

    return plcs, tags_by_plc, {t["id"]: t for t in tags}


class WriteBuffer:
    """Acumula eventos em memória e grava em lote periodicamente (menos round-trips ao Postgres)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._rows = []

    def add(self, tag_id: int, value, data_type: str, quality: str = "good", time=None,
             tag_name: str | None = None, plc_id: int | None = None):
        event_time = time if time is not None else datetime.now(timezone.utc)
        row = {
            "time": event_time,
            "tag_id": tag_id,
            "value_bool": bool(value) if data_type == "bool" else None,
            "value_num": float(value) if data_type in ("int", "dint", "real") else None,
            "value_str": str(value) if data_type == "string" else None,
            "quality": quality,
        }
        with self._lock:
            self._rows.append(row)

        # Arquitetura híbrida: o histórico (tag_events) também vai pro
        # InfluxDB quando configurado, além do Postgres acima — mesma
        # decisão de gravação, só duplicada pro banco de série temporal.
        # tag_name/plc_id são passados pelos chamadores (main.py) porque a
        # WriteBuffer aqui só vê o tag_id — precisa desse contexto extra
        # pra gravar no InfluxDB, que não tem uma tabela 'tags' pra
        # resolver isso depois via JOIN.
        if influx_buffer is not None and tag_name is not None and plc_id is not None:
            influx_buffer.add(tag_id, plc_id, tag_name, value, data_type, quality, event_time)

    def flush(self, conn):
        with self._lock:
            rows, self._rows = self._rows, []
        if not rows:
            return

        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO tag_events (time, tag_id, value_bool, value_num, value_str, quality)
                VALUES (%(time)s, %(tag_id)s, %(value_bool)s, %(value_num)s, %(value_str)s, %(quality)s)
                """,
                rows,
            )
            # upsert do último valor conhecido, usado por regras 'conditional'.
            # executemany em vez de um loop de execute() por linha — com
            # milhares de linhas por flush (ex: 4000 tags em deadband
            # mudando com frequência), o loop fazia o flush demorar mais
            # que o intervalo entre flushes, atrasando tudo que vem depois
            # dele na mesma passada (inclusive o heartbeat de status).
            cur.executemany(
                """
                INSERT INTO tag_last_value (tag_id, value_bool, value_num, value_str, updated_at)
                VALUES (%(tag_id)s, %(value_bool)s, %(value_num)s, %(value_str)s, now())
                ON CONFLICT (tag_id) DO UPDATE SET
                    value_bool = EXCLUDED.value_bool,
                    value_num = EXCLUDED.value_num,
                    value_str = EXCLUDED.value_str,
                    updated_at = now()
                """,
                rows,
                )
        logger.debug("Gravados %d eventos", len(rows))


write_buffer = WriteBuffer()
engine = LoggingEngine()

influx_buffer = InfluxWriteBuffer(INFLUXDB_HOST, INFLUXDB_TOKEN, INFLUXDB_DATABASE) if INFLUXDB_HOST else None
if influx_buffer is not None:
    logger.info("InfluxDB configurado (%s, banco '%s') — tag_events também será gravado lá.", INFLUXDB_HOST, INFLUXDB_DATABASE)
else:
    logger.info("INFLUXDB_HOST não configurado — gravando só no Postgres, como sempre.")


class StatusBuffer:
    """
    Guarda o estado de conexão mais recente de cada CLP em memória e deixa
    o flush_loop persistir isso no Postgres. O timestamp gravado é o
    momento real em que a thread de polling reportou o status (capturado
    aqui, não na hora do flush) — assim, se uma thread travar ou morrer,
    o timestamp para de avançar e a API consegue detectar isso como
    "offline" mesmo que o flush_loop continue rodando normalmente.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._status: dict[int, dict] = {}

    def set(self, plc_id: int, connected: bool, error: str | None = None):
        with self._lock:
            self._status[plc_id] = {
                "connected": connected,
                "last_error": error,
                "updated_at": datetime.now(timezone.utc),
            }

    def flush(self, conn):
        with self._lock:
            items = list(self._status.items())
        if not items:
            return

        with conn.cursor() as cur:
            for plc_id, info in items:
                cur.execute(
                    """
                    INSERT INTO plc_status (plc_id, connected, last_error, updated_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (plc_id) DO UPDATE SET
                        connected = EXCLUDED.connected,
                        last_error = EXCLUDED.last_error,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (plc_id, info["connected"], info["last_error"], info["updated_at"]),
                )


status_buffer = StatusBuffer()


class TagStatusBuffer:
    """
    Igual à StatusBuffer, mas por TAG em vez de por CLP: guarda se a
    última tentativa de LEITURA daquela tag específica teve sucesso, a
    cada ciclo — independente da regra de gravação decidir escrever
    histórico ou não (ex: uma tag em 'deadband' que não mudou de valor há
    dias continua "ok" aqui, mesmo sem gravar nada em tag_events).
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._status: dict[int, dict] = {}

    def set(self, tag_id: int, ok: bool):
        with self._lock:
            self._status[tag_id] = {"ok": ok, "updated_at": datetime.now(timezone.utc)}

    def flush(self, conn):
        with self._lock:
            items = list(self._status.items())
        if not items:
            return

        rows = [
            {"tag_id": tag_id, "ok": info["ok"], "updated_at": info["updated_at"]}
            for tag_id, info in items
        ]
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO tag_status (tag_id, ok, updated_at)
                VALUES (%(tag_id)s, %(ok)s, %(updated_at)s)
                ON CONFLICT (tag_id) DO UPDATE SET
                    ok = EXCLUDED.ok,
                    updated_at = EXCLUDED.updated_at
                """,
                rows,
            )


tag_status_buffer = TagStatusBuffer()


def poll_plc_loop(plc: dict, get_current_tags, get_current_poll_interval_ms):
    """Loop de polling de um único CLP, roda em sua própria thread."""
    try:
        driver_cls = get_driver_class(plc["driver"])
    except ValueError as exc:
        logger.error(
            "CLP '%s' usa driver '%s', que ainda não tem implementação no coletor (%s). "
            "Ele fica cadastrado mas sem coleta até o driver ser implementado.",
            plc["name"], plc["driver"], exc,
        )
        return
    driver = driver_cls(plc)

    # Recalculado a cada ciclo (ver abaixo) — não fica fixo pra sempre no
    # valor de quando a thread começou. Isso permite mudar o scan rate
    # pela tela de CLPs e ver efeito no próximo ciclo de recarga (até
    # RELOAD_INTERVAL_S depois), sem precisar reiniciar o serviço.
    interval_s = max(get_current_poll_interval_ms(plc["id"]) or plc["poll_interval_ms"], 100) / 1000.0
    backoff_s = interval_s

    while True:
        cycle_start = time.monotonic()
        interval_s = max(get_current_poll_interval_ms(plc["id"]) or plc["poll_interval_ms"], 100) / 1000.0

        tags = get_current_tags(plc["id"])
        if not tags:
            status_buffer.set(plc["id"], driver.is_connected)
            time.sleep(interval_s)
            continue

        if not driver.is_connected:
            if not driver.connect():
                status_buffer.set(plc["id"], False, "falha ao conectar")
                logger.warning("Sem conexão com %s, tentando novamente em %.1fs", plc["name"], backoff_s)
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, 30)
                continue
            backoff_s = interval_s
            logger.info("Conectado a %s (%s)", plc["name"], plc["ip_address"])

        read_start = time.monotonic()
        values = driver.read_tags(tags)
        read_elapsed_s = time.monotonic() - read_start
        status_buffer.set(plc["id"], driver.is_connected)

        # heartbeat por tag: sucesso/falha da leitura deste ciclo,
        # independente da regra de gravação decidir escrever ou não
        for t in tags:
            tag_status_buffer.set(t["id"], t["id"] in values)

        # Snapshot do cache ANTES de qualquer atualização deste ciclo.
        # Importante: tags no modo 'conditional' comparam o valor da tag de
        # gatilho contra o valor "de antes deste ciclo" — se lêssemos direto
        # de engine._last_values durante o loop, o resultado dependeria da
        # ordem (não garantida) em que as tags são processadas: se a tag de
        # gatilho for processada antes da tag condicional na mesma
        # iteração, o cache dela já estaria atualizado pro valor atual,
        # fazendo a borda 0->1 nunca ser detectada corretamente.
        old_snapshot = dict(engine._last_values)

        for t in tags:
            tag_id = t["id"]
            if tag_id not in values:
                continue
            new_value = values[tag_id]

            try:
                cfg = TagConfig(
                    id=t["id"], plc_id=t["plc_id"], name=t["name"], address=t["address"],
                    data_type=t["data_type"], logging_mode=t["logging_mode"],
                    deadband_value=t["deadband_value"], trigger_tag_id=t["trigger_tag_id"],
                    trigger_condition=t["trigger_condition"], trigger_value=t["trigger_value"],
                )

                if cfg.logging_mode == "conditional":
                    # a decisão depende do valor da trigger tag, não da própria tag
                    trigger_id = cfg.trigger_tag_id
                    old_trigger = old_snapshot.get(trigger_id)
                    new_trigger = values.get(trigger_id, old_trigger)
                    should = engine.evaluate_trigger(
                        cfg.trigger_condition, old_trigger, new_trigger, float(cfg.trigger_value) if cfg.trigger_value is not None else None
                    )
                    engine._last_values[tag_id] = new_value  # atualiza cache sem decidir por ele mesmo
                    if should:
                        write_buffer.add(tag_id, new_value, cfg.data_type, tag_name=t["name"], plc_id=t["plc_id"])
                elif cfg.logging_mode == "compression":
                    # swinging-door: pode gravar 0, 1 ou 2 pontos por ciclo
                    # (dois quando a porta fecha por desvio real — o ponto
                    # anterior retido em buffer + o atual, pra não deixar o
                    # gráfico interpolar uma reta enganosa entre os dois).
                    # trigger_value é reaproveitado aqui como o intervalo
                    # máximo (segundos) entre gravações — força um ponto
                    # mesmo sem quebra de tolerância, se configurado.
                    sample_time = datetime.now(timezone.utc)
                    max_time_s = float(cfg.trigger_value) if cfg.trigger_value is not None else None
                    points = engine.compress(
                        tag_id, sample_time, new_value, float(cfg.deadband_value or 0), max_time_s
                    )
                    engine._last_values[tag_id] = new_value  # cache "valor atual", igual aos outros modos
                    for point_time, point_value in points:
                        write_buffer.add(tag_id, point_value, cfg.data_type, time=point_time, tag_name=t["name"], plc_id=t["plc_id"])
                else:
                    if engine.should_log(cfg, new_value):
                        write_buffer.add(tag_id, new_value, cfg.data_type, tag_name=t["name"], plc_id=t["plc_id"])
            except Exception:
                # erro numa tag (ex: valor inesperado, tipo incompatível) não
                # pode derrubar a leitura das outras tags do mesmo CLP
                logger.exception("Falha processando tag '%s' (id=%s) em %s", t["name"], tag_id, plc["name"])

        # Desconta o tempo já gasto lendo/processando deste sleep, pra manter
        # o intervalo real o mais próximo possível do configurado. Se a
        # leitura sozinha já estourou o intervalo, dorme só o mínimo (não dá
        # pra "recuperar" tempo perdido, mas evita empilhar atraso ciclo
        # após ciclo). Loga quando isso acontece, pra ficar visível que o
        # ciclo está sendo limitado pelo tempo de leitura, não pelo sleep.
        elapsed_s = time.monotonic() - cycle_start
        remaining_s = interval_s - elapsed_s
        if remaining_s > 0:
            time.sleep(remaining_s)
        else:
            process_elapsed_s = elapsed_s - read_elapsed_s
            logger.warning(
                "Ciclo de %s levou %.2fs (leitura: %.2fs, processamento Python: %.2fs), "
                "mais que o intervalo configurado (%.2fs). %s",
                plc["name"], elapsed_s, read_elapsed_s, process_elapsed_s, interval_s,
                "A REDE é o fator limitante." if read_elapsed_s > process_elapsed_s
                else "O PROCESSAMENTO em Python é o fator limitante, não a rede — "
                     "considere reduzir a quantidade de tags nesse CLP ou revisar a "
                     "carga da máquina (CPU/outros processos).",
            )


def flush_loop():
    """Grava os dados de processo (tag_events + tag_last_value) — pode ser
    o lote mais pesado, então fica na sua própria conexão, separado do
    heartbeat de status abaixo."""
    with get_conn() as conn:
        while True:
            time.sleep(WRITE_BATCH_INTERVAL_S)
            try:
                write_buffer.flush(conn)
            except Exception:
                logger.exception("Falha ao gravar lote de eventos")


def status_flush_loop():
    """Grava os heartbeats de status (por CLP e por tag) — deliberadamente
    em conexão e loop PRÓPRIOS, separados do flush_loop acima. Se o flush
    de dados demorar mais que o normal (lote grande, contenção no banco),
    o heartbeat de status continua atualizando no ritmo dele, sem ficar
    represado atrás do backlog de dados — é o que garante que a bolinha
    de status reflita a realidade mesmo sob carga pesada de escrita."""
    with get_conn() as conn:
        while True:
            time.sleep(WRITE_BATCH_INTERVAL_S)
            try:
                status_buffer.flush(conn)
                tag_status_buffer.flush(conn)
            except Exception:
                logger.exception("Falha ao gravar heartbeat de status")


def scheduler_watchdog_loop():
    """
    Thread de diagnóstico pura — não toca em rede, banco nem CLP nenhum.
    Só dorme 100ms repetidamente e mede quanto tempo REALMENTE passou. Se
    isso também mostrar atrasos de segundos, prova que o processo (ou a
    própria VM) está sendo pausado por completo em algum momento — não é
    nada específico de um driver, de rede ou de um CLP. Se ISSO ficar
    sempre preciso enquanto os pollers atrasam, aí sim o problema está
    isolado em alguma das threads de leitura, não no processo inteiro.
    """
    target_s = 0.1
    last = time.monotonic()
    while True:
        time.sleep(target_s)
        now = time.monotonic()
        actual = now - last
        last = now
        if actual > target_s * 3:  # esperado ~0.1s; qualquer coisa > 0.3s é suspeito
            logger.warning(
                "WATCHDOG: pausa de agendamento de %.2fs detectada numa thread sem "
                "rede/banco/CLP nenhum (esperado ~%.2fs) — indica o processo ou a VM "
                "inteira tendo sido pausada, não um problema de driver específico.",
                actual, target_s,
            )


def main():
    logger.info("Wtecc Historian Collector iniciando...")

    state = {"plcs": [], "tags_by_plc": {}, "tags_by_id": {}}
    started_plc_ids = set()
    state_lock = threading.Lock()

    def get_current_tags(plc_id: int):
        with state_lock:
            return list(state["tags_by_plc"].get(plc_id, []))

    def get_current_poll_interval_ms(plc_id: int):
        with state_lock:
            for p in state["plcs"]:
                if p["id"] == plc_id:
                    return p["poll_interval_ms"]
            return None

    def reload_loop():
        while True:
            try:
                plcs, tags_by_plc, tags_by_id = load_config()
                with state_lock:
                    state["plcs"] = plcs
                    state["tags_by_plc"] = tags_by_plc
                    state["tags_by_id"] = tags_by_id

                for plc in plcs:
                    if plc["id"] not in started_plc_ids:
                        started_plc_ids.add(plc["id"])
                        th = threading.Thread(
                            target=poll_plc_loop,
                            args=(plc, get_current_tags, get_current_poll_interval_ms),
                            daemon=True,
                        )
                        th.start()
                        logger.info("Thread de polling iniciada para %s", plc["name"])
            except Exception:
                logger.exception("Falha ao recarregar configuração")

            time.sleep(RELOAD_INTERVAL_S)

    threading.Thread(target=flush_loop, daemon=True).start()
    threading.Thread(target=status_flush_loop, daemon=True).start()
    threading.Thread(target=scheduler_watchdog_loop, daemon=True).start()
    if influx_buffer is not None:
        threading.Thread(target=influx_flush_loop, args=(influx_buffer, WRITE_BATCH_INTERVAL_S), daemon=True).start()
    reload_loop()  # roda no thread principal


if __name__ == "__main__":
    main()
