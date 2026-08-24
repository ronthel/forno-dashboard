#!/usr/bin/env bash
# Restaura um pacote gerado por backup-instalacao.sh numa máquina NOVA
# (cliente/linha/máquina diferente) e faz a reconfiguração obrigatória:
# troca TODAS as senhas/tokens, apaga o histórico e o CLP da instalação de
# origem, e pede os dados do CLP do cliente novo. Ao final, a instalação
# fica isolada — nenhuma credencial da origem sobrevive aqui.
#
# Uso (na máquina de destino, com Docker já instalado):
#   ./clonar-instalacao.sh /caminho/para/backup-forno-<data>-<hora>  [/caminho/de/destino]
#
# Se /caminho/de/destino não for informado, instala em ~/projects/forno-dashboard
set -euo pipefail

BACKUP_DIR="${1:?Uso: $0 /caminho/para/backup-forno-<data>-<hora> [/caminho/de/destino]}"
DEST_DIR="${2:-$HOME/projects/forno-dashboard}"

[ -d "$BACKUP_DIR" ] || { echo "Erro: pasta de backup não encontrada: $BACKUP_DIR"; exit 1; }
# resolve pra caminho absoluto AGORA — o script troca de pasta (cd "$DEST_DIR")
# mais adiante, e se BACKUP_DIR tivesse ficado relativo (ex: "."), passaria a
# apontar pro lugar errado depois da troca (o docker load falharia sem achar
# o arquivo, silenciosamente antes até de chegar nas perguntas).
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
for f in projeto.tar.gz imagens.tar forno_db.sql historian_db.sql influxdb_data.tar.gz; do
  [ -f "$BACKUP_DIR/$f" ] || { echo "Erro: arquivo esperado não encontrado no backup: $f"; exit 1; }
done

command -v docker >/dev/null 2>&1 || { echo "Erro: Docker não encontrado. Instale o Docker antes de continuar."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Erro: plugin 'docker compose' não encontrado."; exit 1; }

# --- 0. Extrai o projeto no destino ----------------------------------------
if [ -d "$DEST_DIR" ] && [ -n "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
  echo "A pasta de destino já existe e não está vazia: $DEST_DIR"
  echo "Este script é só para instalação NOVA — ele vai APAGAR o conteúdo atual dessa pasta antes de restaurar o backup."
  read -rp "Tem certeza? Digite 'apagar tudo' para confirmar: " confirm
  [ "$confirm" = "apagar tudo" ] || { echo "Cancelado pelo usuário."; exit 1; }
  # se já houver uma instalação docker rodando ali, derruba primeiro
  ( cd "$DEST_DIR" && docker compose down -v --remove-orphans 2>/dev/null || true )
  rm -rf "${DEST_DIR:?}"/*
fi
mkdir -p "$(dirname "$DEST_DIR")"
tar xzf "$BACKUP_DIR/projeto.tar.gz" -C "$(dirname "$DEST_DIR")"
# projeto.tar.gz guarda a pasta com o nome original (ex: forno-dashboard) —
# renomeia pra bater com o destino pedido, se for diferente.
EXTRAIDO="$(dirname "$DEST_DIR")/$(tar tzf "$BACKUP_DIR/projeto.tar.gz" | head -1 | cut -d/ -f1 || true)"
[ "$EXTRAIDO" = "$DEST_DIR" ] || mv "$EXTRAIDO" "$DEST_DIR"

cd "$DEST_DIR"
source scripts/lib-comum.sh

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-forno-dashboard}"
COMPOSE_ARGS=(-p "$COMPOSE_PROJECT_NAME")

log "Clonagem — Forno Dashboard + Wtecc Historian"
echo "Esta instalação vai nascer com os DADOS de hoje, mas TODAS as senhas/"
echo "tokens serão trocados e o histórico + CLP da origem serão apagados ao"
echo "final — o que sobra são só o código e a estrutura, testados e prontos."

# guarda as credenciais ORIGINAIS (vieram dentro do .env restaurado) — são
# usadas só como chave de transição pra autenticar a troca; não sobrevivem
# ao final deste script.
OLD_POSTGRES_PASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
OLD_HISTORIAN_DB_PASSWORD="$(grep -m1 '^HISTORIAN_DB_PASSWORD=' .env | cut -d= -f2-)"
OLD_INFLUX_TOKEN="$(grep -m1 '^INFLUX_TOKEN=' .env | cut -d= -f2-)"
[ -n "$OLD_POSTGRES_PASSWORD" ] && [ -n "$OLD_HISTORIAN_DB_PASSWORD" ] && [ -n "$OLD_INFLUX_TOKEN" ] \
  || fail "Não encontrei as credenciais originais dentro do .env restaurado — backup incompleto?"

# --- 1. Carrega as imagens já testadas (sem rebuild) -----------------------
log "Carregando imagens Docker já testadas..."
docker load -i "$BACKUP_DIR/imagens.tar"

# --- 2. IP desta máquina ----------------------------------------------------
DETECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
read -rp "IP desta máquina na rede local [${DETECTED_IP}]: " HOST_LAN_IP
HOST_LAN_IP="${HOST_LAN_IP:-$DETECTED_IP}"
[ -n "$HOST_LAN_IP" ] || fail "IP não informado."
sed -i "s#^HOST_LAN_IP=.*#HOST_LAN_IP=$HOST_LAN_IP#" .env
sed -i "s#^VITE_API_URL=.*#VITE_API_URL=http://$HOST_LAN_IP:5000#" frontend/.env

# --- 3. Sobe os bancos (ainda com as credenciais ORIGINAIS) e restaura -----
# O historian-db roda init-schema.sql/init-status-tables.sql/seed-data.sql
# sozinho no primeiro boot (docker-entrypoint-initdb.d) — se deixarmos isso
# acontecer, o schema já existe quando o dump completo tenta recriá-lo por
# cima, e dá erro em cascata ("already exists", hypertable duplicada, PLC
# duplicado). Solução: tira esses 3 arquivos do caminho ANTES do primeiro
# boot (o dump já traz o schema completo dentro dele) e devolve depois.
mkdir -p /tmp/clone-init-backup
mv historian/init-schema.sql historian/init-status-tables.sql historian/seed-data.sql /tmp/clone-init-backup/
for f in init-schema.sql init-status-tables.sql seed-data.sql; do
  echo "-- neutralizado durante a clonagem, restaurado ao final" > "historian/$f"
done

log "Subindo Postgres e TimescaleDB..."
docker compose "${COMPOSE_ARGS[@]}" up -d postgres historian-db
aguardar_healthy "$COMPOSE_PROJECT_NAME" postgres
aguardar_healthy "$COMPOSE_PROJECT_NAME" historian-db

# devolve os arquivos originais assim que o schema vazio já subiu — eles
# só têm efeito no boot inicial do container, então dá pra restaurar já
mv /tmp/clone-init-backup/*.sql historian/
rmdir /tmp/clone-init-backup

log "Restaurando dados do banco do dashboard..."
docker exec -i "${COMPOSE_PROJECT_NAME}-postgres-1" psql -U forno_app -d forno_db < "$BACKUP_DIR/forno_db.sql" >/dev/null

log "Restaurando dados do Historian..."
# timescaledb_pre_restore()/post_restore() são obrigatórios pro TimescaleDB
# — sem eles, o restore falha com um monte de erro de "already exists" e
# "ONLY option not supported on hypertable operations" (as tabelas de
# hypertable/continuous aggregate colidem com o que o pg_dump gera).
docker exec "${COMPOSE_PROJECT_NAME}-historian-db-1" psql -U wtecc -d wtecc_historian -c "SELECT timescaledb_pre_restore();" >/dev/null
docker exec -i "${COMPOSE_PROJECT_NAME}-historian-db-1" psql -U wtecc -d wtecc_historian < "$BACKUP_DIR/historian_db.sql" >/dev/null
docker exec "${COMPOSE_PROJECT_NAME}-historian-db-1" psql -U wtecc -d wtecc_historian -c "SELECT timescaledb_post_restore();" >/dev/null

log "Restaurando dados do InfluxDB..."
INFLUX_VOLUME="${COMPOSE_PROJECT_NAME}_influxdb_data"
docker volume create "$INFLUX_VOLUME" >/dev/null
docker run --rm -v "${INFLUX_VOLUME}:/data" -v "$BACKUP_DIR:/backup:ro" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/influxdb_data.tar.gz -C /data && chown -R 1500:1500 /data"
docker compose "${COMPOSE_ARGS[@]}" up -d influxdb

# --- 4. Sobe o resto dos serviços (imagens já carregadas, sem rebuild) -----
log "Subindo o restante dos serviços..."
docker compose "${COMPOSE_ARGS[@]}" up -d

log "Aguardando a API do Historian ficar pronta..."
HISTORIAN_API_CONTAINER="${COMPOSE_PROJECT_NAME}-historian-api-1"
for _ in $(seq 1 30); do
  docker exec "$HISTORIAN_API_CONTAINER" python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" >/dev/null 2>&1 && break
  sleep 2
done

# --- 5. RECONFIGURAÇÃO OBRIGATÓRIA -----------------------------------------
log "Isolando esta instalação — trocando todas as senhas/tokens da origem"

POSTGRES_CONTAINER="${COMPOSE_PROJECT_NAME}-postgres-1"
HISTORIAN_DB_CONTAINER="${COMPOSE_PROJECT_NAME}-historian-db-1"
INFLUX_CONTAINER="${COMPOSE_PROJECT_NAME}-influxdb-1"

NEW_POSTGRES_PASSWORD="$(gen_hex 16)"
docker exec "$POSTGRES_CONTAINER" psql -U forno_app -d forno_db -c "ALTER USER forno_app WITH PASSWORD '$NEW_POSTGRES_PASSWORD';" >/dev/null

NEW_HISTORIAN_DB_PASSWORD="$(gen_hex 16)"
docker exec "$HISTORIAN_DB_CONTAINER" psql -U wtecc -d wtecc_historian -c "ALTER USER wtecc WITH PASSWORD '$NEW_HISTORIAN_DB_PASSWORD';" >/dev/null

NEW_HISTORIAN_JWT_SECRET="$(gen_hex 32)"
NEW_BACKEND_JWT_SECRET="$(gen_hex 32)"

log "Regenerando o token do InfluxDB (invalida o token antigo)..."
# --regenerate pede confirmação interativa ("Enter 'yes' to confirm") e não
# tem flag --yes — só dá pra automatizar mandando "yes" pelo stdin.
NEW_INFLUX_TOKEN_OUTPUT="$(echo yes | docker exec -i "$INFLUX_CONTAINER" influxdb3 create token --admin --regenerate --token "$OLD_INFLUX_TOKEN" 2>&1)"
NEW_INFLUX_TOKEN="$(echo "$NEW_INFLUX_TOKEN_OUTPUT" | grep -oE 'apiv3_[A-Za-z0-9_-]+' | head -1 || true)"
[ -n "$NEW_INFLUX_TOKEN" ] || fail "Não consegui regenerar o token do InfluxDB. Saída: $NEW_INFLUX_TOKEN_OUTPUT"

log "Apagando o histórico de dados da instalação de origem no InfluxDB..."
docker exec "$INFLUX_CONTAINER" influxdb3 delete database forno --token "$NEW_INFLUX_TOKEN" --yes --hard-delete now >/dev/null 2>&1 || true
docker exec "$INFLUX_CONTAINER" influxdb3 create database forno --token "$NEW_INFLUX_TOKEN" >/dev/null

log "Apagando o CLP, tags e histórico da instalação de origem..."
docker exec "$HISTORIAN_DB_CONTAINER" psql -U wtecc -d wtecc_historian -c \
  "TRUNCATE tag_events, tag_last_value, tag_status, plc_status, tags, plcs RESTART IDENTITY CASCADE;" >/dev/null

log "Apagando usuários, alarmes, auditoria e variáveis configuradas na origem..."
docker exec "$POSTGRES_CONTAINER" psql -U forno_app -d forno_db -c \
  "TRUNCATE alarm_history, audit_log, dashboard_layouts, dashboards, sensores_config, turnos_config, users RESTART IDENTITY CASCADE;" >/dev/null

# senhas novas do Historian (as antigas eram da origem — role_credentials
# tem estrutura mantida, mas o conteúdo é sobrescrito com senhas novas)
HISTORIAN_ADMIN_PASSWORD="$(gen_pass)"
HISTORIAN_OPERATOR_PASSWORD="$(gen_pass)"
HISTORIAN_VIEWER_PASSWORD="$(gen_pass)"
configurar_senhas_historian "$HISTORIAN_API_CONTAINER" "$HISTORIAN_DB_CONTAINER" \
  "$HISTORIAN_ADMIN_PASSWORD" "$HISTORIAN_OPERATOR_PASSWORD" "$HISTORIAN_VIEWER_PASSWORD"

# --- 6. Cadastra o CLP do cliente NOVO --------------------------------------
prompt_clp
docker exec "$HISTORIAN_DB_CONTAINER" psql -U wtecc -d wtecc_historian -c \
  "INSERT INTO plcs (name, brand, model, driver, ip_address, slot, rack, poll_interval_ms, enabled)
   VALUES ('$PLC_NAME', '$PLC_BRAND', '$PLC_MODEL', '$PLC_DRIVER', '$PLC_IP', $PLC_SLOT_SQL, $PLC_RACK_SQL, 5000, true);" >/dev/null

# --- 7. Reescreve os .env com as credenciais novas e reinicia -------------
log "Gravando credenciais novas nos arquivos .env..."
sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$NEW_POSTGRES_PASSWORD#" .env backend/.env
sed -i "s#^HISTORIAN_DB_PASSWORD=.*#HISTORIAN_DB_PASSWORD=$NEW_HISTORIAN_DB_PASSWORD#" .env
sed -i "s#^HISTORIAN_JWT_SECRET=.*#HISTORIAN_JWT_SECRET=$NEW_HISTORIAN_JWT_SECRET#" .env
sed -i "s#^INFLUX_TOKEN=.*#INFLUX_TOKEN=$NEW_INFLUX_TOKEN#" .env backend/.env
sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$NEW_BACKEND_JWT_SECRET#" backend/.env
sed -i "s#^HISTORIAN_VIEWER_PASSWORD=.*#HISTORIAN_VIEWER_PASSWORD=$HISTORIAN_VIEWER_PASSWORD#" backend/.env

log "Reiniciando os serviços pra usarem as credenciais novas..."
docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate \
  backend frontend historian-api historian-frontend historian-collector

# --- 8. Resumo final ---------------------------------------------------------
log "Clonagem concluída — instalação isolada e pronta!"
cat <<EOF

  Dashboard:         http://$HOST_LAN_IP:3000
                     (usuários da instalação de origem foram apagados — o
                      próximo cadastro na tela de login vira administrador)

  Historian (CLPs):  http://$HOST_LAN_IP:3001
                     admin    = $HISTORIAN_ADMIN_PASSWORD
                     operator = $HISTORIAN_OPERATOR_PASSWORD
                     viewer   = $HISTORIAN_VIEWER_PASSWORD

  CLP cadastrado:    $PLC_NAME ($PLC_IP, driver $PLC_DRIVER)
                     Sem tags ainda — cadastre pela tela do Historian.

  ATENÇÃO: guarde essas senhas agora — elas não são mostradas de novo.
  Todas as credenciais da instalação de origem foram invalidadas; esta
  instalação está isolada e não compartilha nenhum segredo com ela.

  Não esqueça de apagar o pacote de backup ($BACKUP_DIR) desta máquina
  e de qualquer lugar temporário por onde ele passou.

EOF
