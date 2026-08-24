#!/usr/bin/env bash
# Instalação/provisionamento do Forno Dashboard + Wtecc Historian.
#
# Roda UMA VEZ por instalação nova (cliente/linha/máquina), a partir de um
# clone limpo deste repositório, numa máquina Linux com Docker + Docker
# Compose já instalados. Gera sozinho todas as senhas/tokens/chaves — só
# pergunta o que realmente muda de site pra site (IP do CLP, IP desta
# máquina), porque cada instalação deve ter credenciais PRÓPRIAS (nunca
# reaproveitar as de outro cliente — ver README para o porquê).
#
# Uso:
#   git clone git@github.com:ronthel/forno-dashboard.git
#   cd forno-dashboard
#   ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

# Aceita um prefixo de projeto/portas alternativo pra rodar em modo de
# teste, sem colidir com uma instalação de produção na mesma máquina
# (usado pelo próprio time interno pra validar o script — não precisa
# disso numa instalação real).
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-forno-dashboard}"
COMPOSE_ARGS=(-p "$COMPOSE_PROJECT_NAME")

log()  { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErro: %s\033[0m\n' "$1"; exit 1; }

# --- 0. Checagens básicas ------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "Docker não encontrado. Instale o Docker antes de continuar."
docker compose version >/dev/null 2>&1 || fail "Plugin 'docker compose' não encontrado."
command -v openssl >/dev/null 2>&1 || fail "openssl não encontrado (necessário pra gerar as senhas)."

# Se já existe .env OU containers desse projeto, a instalação precisa
# começar de um estado REALMENTE limpo — não dá pra "consertar" no meio
# (ex: o InfluxDB recusa criar um token admin novo se um antigo já existe,
# e regenerar exige o token antigo em mãos, que podemos não ter se uma
# tentativa anterior falhou no meio do caminho). Mais simples e mais
# seguro: apagar tudo (containers + volumes) e recomeçar do zero.
EXISTING="$( { [ -f .env ] && echo sim; docker compose "${COMPOSE_ARGS[@]}" ps -a --format '{{.Name}}' 2>/dev/null; } )"
if [ -n "$EXISTING" ]; then
  echo "Já existe uma instalação (arquivo .env e/ou containers) para o projeto '$COMPOSE_PROJECT_NAME'."
  echo "Este script é só para instalação NOVA — ele vai APAGAR containers E volumes (todos os dados) antes de recomeçar do zero."
  read -rp "Tem certeza? Digite 'apagar tudo' para confirmar: " confirm
  [ "$confirm" = "apagar tudo" ] || fail "Cancelado pelo usuário."
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans || true
  rm -f .env backend/.env frontend/.env
fi

log "Instalação — Forno Dashboard + Wtecc Historian"

# --- 1. IP desta máquina na rede local -----------------------------------
DETECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
read -rp "IP desta máquina na rede local [${DETECTED_IP}]: " HOST_LAN_IP
HOST_LAN_IP="${HOST_LAN_IP:-$DETECTED_IP}"
[ -n "$HOST_LAN_IP" ] || fail "IP não informado."

# --- 2. Dados do CLP a ser monitorado -------------------------------------
log "Dados do CLP"
read -rp "Nome do CLP (ex: Forno01): " PLC_NAME
[ -n "$PLC_NAME" ] || fail "Nome do CLP é obrigatório."
read -rp "IP do CLP: " PLC_IP
[ -n "$PLC_IP" ] || fail "IP do CLP é obrigatório."

echo "Fabricante do CLP:"
echo "  1) Rockwell (CompactLogix / ControlLogix)"
echo "  2) Siemens (S7-1500 / S7-1200)"
echo "  3) Schneider (M580 / Modbus TCP)"
read -rp "Escolha [1]: " PLC_CHOICE
case "${PLC_CHOICE:-1}" in
  2)
    PLC_BRAND="siemens"; PLC_MODEL="S7-1500"; PLC_DRIVER="siemens_s7"
    read -rp "Rack do CLP [0]: " PLC_RACK; PLC_RACK="${PLC_RACK:-0}"
    read -rp "Slot do CLP [1]: " PLC_SLOT; PLC_SLOT="${PLC_SLOT:-1}"
    ;;
  3)
    PLC_BRAND="schneider"; PLC_MODEL="M580"; PLC_DRIVER="schneider_modbus"
    PLC_RACK="NULL"; PLC_SLOT="NULL"
    ;;
  *)
    PLC_BRAND="rockwell"; PLC_MODEL="CompactLogix"; PLC_DRIVER="rockwell_logix"
    read -rp "Slot do CLP [0]: " PLC_SLOT; PLC_SLOT="${PLC_SLOT:-0}"
    PLC_RACK="NULL"
    ;;
esac
if [ "${PLC_SLOT:-NULL}" = "NULL" ]; then PLC_SLOT_SQL="NULL"; else PLC_SLOT_SQL="$PLC_SLOT"; fi
if [ "${PLC_RACK:-NULL}" = "NULL" ]; then PLC_RACK_SQL="NULL"; else PLC_RACK_SQL="$PLC_RACK"; fi

# --- 3. Gera todas as senhas/tokens/chaves --------------------------------
log "Gerando credenciais novas (nenhuma reaproveitada de outra instalação)"
gen_hex()    { openssl rand -hex "$1"; }
gen_pass()   { openssl rand -base64 18 | tr -d '=+/\n'; }

POSTGRES_USER="forno_app"
POSTGRES_DB="forno_db"
POSTGRES_PASSWORD="$(gen_hex 16)"
HISTORIAN_DB_PASSWORD="$(gen_hex 16)"
HISTORIAN_JWT_SECRET="$(gen_hex 32)"
BACKEND_JWT_SECRET="$(gen_hex 32)"
HISTORIAN_ADMIN_PASSWORD="$(gen_pass)"
HISTORIAN_OPERATOR_PASSWORD="$(gen_pass)"
HISTORIAN_VIEWER_PASSWORD="$(gen_pass)"

# --- 4. Escreve os .env ---------------------------------------------------
log "Gravando arquivos .env"

cat > .env <<EOF
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB
HISTORIAN_DB_PASSWORD=$HISTORIAN_DB_PASSWORD
HISTORIAN_JWT_SECRET=$HISTORIAN_JWT_SECRET
HOST_LAN_IP=$HOST_LAN_IP
INFLUX_TOKEN=
EOF

mkdir -p backend frontend
cat > backend/.env <<EOF
PORT=5000
JWT_SECRET=$BACKEND_JWT_SECRET
POSTGRES_USER=$POSTGRES_USER
POSTGRES_HOST=postgres
POSTGRES_DB=$POSTGRES_DB
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_PORT=5432
INFLUX_URL=http://influxdb:8181
INFLUX_TOKEN=
INFLUX_BUCKET=forno
HISTORIAN_API_URL=http://historian-api:8000
HISTORIAN_VIEWER_PASSWORD=$HISTORIAN_VIEWER_PASSWORD
EOF

cat > frontend/.env <<EOF
VITE_API_URL=http://$HOST_LAN_IP:5000
EOF

# --- 5. Gera o seed do Historian com os dados do CLP informados -----------
# Sem tags pré-cadastradas de propósito — cada CLP tem tags totalmente
# diferentes, o operador cadastra pela tela do Historian depois de subir.
cat > historian/seed-data.sql <<EOF
INSERT INTO plcs (name, brand, model, driver, ip_address, slot, rack, poll_interval_ms, enabled)
VALUES ('$PLC_NAME', '$PLC_BRAND', '$PLC_MODEL', '$PLC_DRIVER', '$PLC_IP', $PLC_SLOT_SQL, $PLC_RACK_SQL, 5000, true)
ON CONFLICT (name) DO NOTHING;
EOF

# --- 6. Sobe a infraestrutura base (bancos) primeiro ----------------------
log "Subindo Postgres, TimescaleDB e InfluxDB..."
docker compose "${COMPOSE_ARGS[@]}" up -d postgres historian-db influxdb

log "Aguardando os bancos ficarem saudáveis..."
for svc in postgres historian-db; do
  for i in $(seq 1 30); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT_NAME}-${svc}-1" 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && break
    sleep 2
  done
done

INFLUX_CONTAINER="${COMPOSE_PROJECT_NAME}-influxdb-1"
INFLUX_VOLUME="${COMPOSE_PROJECT_NAME}_influxdb_data"

log "Ajustando permissão do volume do InfluxDB (necessário na primeira vez)..."
docker run --rm -v "${INFLUX_VOLUME}:/data" alpine chown -R 1500:1500 /data
docker compose "${COMPOSE_ARGS[@]}" restart influxdb

# --- 7. Cria o token admin do InfluxDB + banco "forno" --------------------
# Em vez de um healthcheck separado (curl pode nem existir dentro dessa
# imagem), tenta criar o token direto e repete até o servidor responder —
# testa exatamente o que precisamos, sem depender de mais nada.
log "Criando token de administração do InfluxDB (tenta até o servidor responder)..."
INFLUX_TOKEN=""
for i in $(seq 1 30); do
  INFLUX_TOKEN_OUTPUT="$(docker exec "$INFLUX_CONTAINER" influxdb3 create token --admin 2>&1)" && true
  INFLUX_TOKEN="$(echo "$INFLUX_TOKEN_OUTPUT" | grep -oE 'apiv3_[A-Za-z0-9_-]+' | head -1)"
  [ -n "$INFLUX_TOKEN" ] && break
  sleep 2
done
[ -n "$INFLUX_TOKEN" ] || fail "Não consegui criar o token do InfluxDB depois de várias tentativas. Última saída: $INFLUX_TOKEN_OUTPUT"

docker exec "$INFLUX_CONTAINER" influxdb3 create database forno --token "$INFLUX_TOKEN"

# grava o token nos .env (sed com delimitador # pra não colidir com o token)
sed -i "s#^INFLUX_TOKEN=.*#INFLUX_TOKEN=$INFLUX_TOKEN#" .env
sed -i "s#^INFLUX_TOKEN=.*#INFLUX_TOKEN=$INFLUX_TOKEN#" backend/.env

# --- 8. Sobe o resto dos serviços ------------------------------------------
log "Construindo e subindo o restante dos serviços (backend, frontend, Historian)..."
docker compose "${COMPOSE_ARGS[@]}" up -d --build

log "Aguardando a API do Historian ficar pronta..."
HISTORIAN_API_CONTAINER="${COMPOSE_PROJECT_NAME}-historian-api-1"
for i in $(seq 1 30); do
  docker exec "$HISTORIAN_API_CONTAINER" python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" >/dev/null 2>&1 && break
  sleep 2
done

# --- 9. Cria as senhas dos 3 papéis do Historian --------------------------
log "Configurando as senhas de acesso do Historian (admin/operator/viewer)..."
HISTORIAN_DB_CONTAINER="${COMPOSE_PROJECT_NAME}-historian-db-1"

ROLE_SQL="$(docker exec "$HISTORIAN_API_CONTAINER" python3 -c "
import bcrypt
pwds = {'admin': '$HISTORIAN_ADMIN_PASSWORD', 'operator': '$HISTORIAN_OPERATOR_PASSWORD', 'viewer': '$HISTORIAN_VIEWER_PASSWORD'}
for role, pw in pwds.items():
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
    print(f\"INSERT INTO role_credentials (role, password_hash) VALUES ('{role}', '{h}') ON CONFLICT (role) DO UPDATE SET password_hash = EXCLUDED.password_hash;\")
")"
echo "$ROLE_SQL" | docker exec -i "$HISTORIAN_DB_CONTAINER" psql -U wtecc -d wtecc_historian >/dev/null

# --- 10. Resumo final ------------------------------------------------------
log "Instalação concluída!"
cat <<EOF

  Dashboard:         http://$HOST_LAN_IP:3000
                     (sem usuário ainda — o primeiro cadastro na tela de
                      login vira administrador automaticamente)

  Historian (CLPs):  http://$HOST_LAN_IP:3001
                     admin    = $HISTORIAN_ADMIN_PASSWORD
                     operator = $HISTORIAN_OPERATOR_PASSWORD
                     viewer   = $HISTORIAN_VIEWER_PASSWORD

  CLP cadastrado:    $PLC_NAME ($PLC_IP, driver $PLC_DRIVER)
                     Sem tags ainda — cadastre pela tela do Historian.

  ATENÇÃO: guarde essas senhas em local seguro agora — elas não são
  mostradas de novo (ficam só como hash no banco). Se perder, é possível
  trocar depois pela própria tela do Historian (como admin).

EOF
