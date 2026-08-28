#!/usr/bin/env bash
# Instalação/provisionamento do Forno Dashboard (visualização/relatórios).
#
# Roda UMA VEZ por instalação nova (cliente/linha/máquina), a partir de um
# clone limpo deste repositório, numa máquina Linux com Docker + Docker
# Compose já instalados. Gera sozinho as senhas/chaves deste projeto — só
# pergunta o que realmente muda de site pra site (IP desta máquina, e como
# chegar no servidor do Wtecc Historian, que pode estar nesta mesma máquina
# ou em outra).
#
# Precisa do Wtecc Historian já instalado e rodando ANTES de rodar este
# script (é ele quem fornece o InfluxDB e a API de tags) — instale-o
# primeiro a partir de github.com/ronthel/wtecc-historian, e guarde os
# valores impressos no final da instalação dele (INFLUX_TOKEN, IP:porta do
# InfluxDB, IP:porta da API, senha do papel "viewer").
#
# Uso:
#   git clone git@github.com:ronthel/forno-dashboard.git
#   cd forno-dashboard
#   ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

# Aceita um prefixo de projeto/portas alternativo pra rodar em modo de
# teste, sem colidir com uma instalação de produção na mesma máquina.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-forno-dashboard}"
COMPOSE_ARGS=(-p "$COMPOSE_PROJECT_NAME")

log()  { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErro: %s\033[0m\n' "$1"; exit 1; }

# --- 0. Checagens básicas ------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "Docker não encontrado. Instale o Docker antes de continuar."
docker compose version >/dev/null 2>&1 || fail "Plugin 'docker compose' não encontrado."
command -v openssl >/dev/null 2>&1 || fail "openssl não encontrado (necessário pra gerar as senhas)."

# Se já existe .env OU containers desse projeto, a instalação precisa
# começar de um estado REALMENTE limpo — mesma lógica do install.sh do
# Historian (não dá pra "consertar" no meio de uma tentativa anterior).
EXISTING="$( { [ -f .env ] && echo sim; docker compose "${COMPOSE_ARGS[@]}" ps -a --format '{{.Name}}' 2>/dev/null; } )"
if [ -n "$EXISTING" ]; then
  echo "Já existe uma instalação (arquivo .env e/ou containers) para o projeto '$COMPOSE_PROJECT_NAME'."
  echo "Este script é só para instalação NOVA — ele vai APAGAR containers E volumes (todos os dados) antes de recomeçar do zero."
  read -rp "Tem certeza? Digite 'apagar tudo' para confirmar: " confirm
  [ "$confirm" = "apagar tudo" ] || fail "Cancelado pelo usuário."
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans || true
  rm -f .env backend/.env frontend/.env
fi

log "Instalação — Forno Dashboard"

# --- 1. IP desta máquina na rede local -----------------------------------
DETECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
read -rp "IP desta máquina na rede local [${DETECTED_IP}]: " HOST_LAN_IP
HOST_LAN_IP="${HOST_LAN_IP:-$DETECTED_IP}"
[ -n "$HOST_LAN_IP" ] || fail "IP não informado."

# --- 2. Onde está o servidor do Wtecc Historian ---------------------------
log "Conexão com o Wtecc Historian (já deve estar instalado e rodando)"
echo "Pode ser esta mesma máquina (se os dois projetos rodam juntos) ou outro servidor."
read -rp "IP do servidor do Historian [${HOST_LAN_IP}]: " HISTORIAN_IP
HISTORIAN_IP="${HISTORIAN_IP:-$HOST_LAN_IP}"
[ -n "$HISTORIAN_IP" ] || fail "IP do servidor do Historian é obrigatório."

read -rp "Porta do InfluxDB no servidor do Historian [8181]: " HISTORIAN_INFLUX_PORT
HISTORIAN_INFLUX_PORT="${HISTORIAN_INFLUX_PORT:-8181}"

read -rp "Porta da API do Historian [8000]: " HISTORIAN_API_PORT
HISTORIAN_API_PORT="${HISTORIAN_API_PORT:-8000}"

echo "Cole os valores impressos no final da instalação do Historian:"
read -rp "INFLUX_TOKEN: " INFLUX_TOKEN
[ -n "$INFLUX_TOKEN" ] || fail "INFLUX_TOKEN é obrigatório."
read -rsp "Senha do papel 'viewer' do Historian: " HISTORIAN_VIEWER_PASSWORD
echo
[ -n "$HISTORIAN_VIEWER_PASSWORD" ] || fail "Senha do papel 'viewer' é obrigatória."

# --- 3. Gera as senhas/chaves deste projeto -------------------------------
log "Gerando credenciais novas (nenhuma reaproveitada de outra instalação)"
gen_hex()    { openssl rand -hex "$1"; }

POSTGRES_USER="forno_app"
POSTGRES_DB="forno_db"
POSTGRES_PASSWORD="$(gen_hex 16)"
BACKEND_JWT_SECRET="$(gen_hex 32)"

# --- 4. Escreve os .env ---------------------------------------------------
log "Gravando arquivos .env"

cat > .env <<EOF
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB
HOST_LAN_IP=$HOST_LAN_IP
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
INFLUX_URL=http://$HISTORIAN_IP:$HISTORIAN_INFLUX_PORT
INFLUX_TOKEN=$INFLUX_TOKEN
INFLUX_BUCKET=forno
HISTORIAN_API_URL=http://$HISTORIAN_IP:$HISTORIAN_API_PORT
HISTORIAN_VIEWER_PASSWORD=$HISTORIAN_VIEWER_PASSWORD
EOF

cat > frontend/.env <<EOF
VITE_API_URL=http://$HOST_LAN_IP:5000
EOF

# --- 5. Sobe o Postgres e aguarda ficar saudável --------------------------
log "Subindo Postgres..."
docker compose "${COMPOSE_ARGS[@]}" up -d postgres

log "Aguardando o Postgres ficar saudável..."
for i in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT_NAME}-postgres-1" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  sleep 2
done

# --- 6. Sobe backend e frontend --------------------------------------------
log "Construindo e subindo backend e frontend..."
docker compose "${COMPOSE_ARGS[@]}" up -d --build

# --- 7. Testa a conexão com o Historian ------------------------------------
log "Testando conexão com o Historian ($HISTORIAN_IP)..."
BACKEND_CONTAINER="${COMPOSE_PROJECT_NAME}-backend-1"
sleep 3
if docker exec "$BACKEND_CONTAINER" node -e "fetch('http://$HISTORIAN_IP:$HISTORIAN_API_PORT/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  echo "OK: API do Historian respondeu."
else
  echo "AVISO: não consegui confirmar a API do Historian em http://$HISTORIAN_IP:$HISTORIAN_API_PORT — confira se ele está rodando e se a porta está liberada no firewall. O dashboard sobe mesmo assim, mas as telas de configuração de variáveis vão falhar até isso ser resolvido."
fi

# --- 8. Resumo final ---------------------------------------------------
log "Instalação concluída!"
cat <<EOF

  Dashboard:  http://$HOST_LAN_IP:3000
              (sem usuário ainda — o primeiro cadastro na tela de login
               vira administrador automaticamente)

  Conectado ao Historian em: $HISTORIAN_IP:$HISTORIAN_INFLUX_PORT (InfluxDB) e $HISTORIAN_IP:$HISTORIAN_API_PORT (API)

EOF
