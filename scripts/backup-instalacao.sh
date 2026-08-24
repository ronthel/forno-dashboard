#!/usr/bin/env bash
# Empacota esta instalação (código + imagens já testadas + bancos de dados)
# num pacote portátil, pronto pra ser clonado em outra máquina/cliente com
# clonar-instalacao.sh.
#
# Roda na máquina de ORIGEM (a instalação que já está validada e funcionando),
# de dentro da pasta do projeto:
#   ./scripts/backup-instalacao.sh
#
# Gera uma pasta ~/backup-forno-<data>-<hora>/ com tudo dentro.
set -euo pipefail
cd "$(dirname "$0")/.."   # volta pra raiz do projeto (scripts/../)
source scripts/lib-comum.sh

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-forno-dashboard}"
COMPOSE_ARGS=(-p "$COMPOSE_PROJECT_NAME")

command -v docker >/dev/null 2>&1 || fail "Docker não encontrado."
[ -f .env ] || fail "Não encontrei .env nesta pasta — rode este script de dentro da instalação já configurada."

OUT_DIR="$HOME/backup-forno-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

log "Empacotando backup em: $OUT_DIR"

# --- 1. Imagens já buildadas e testadas -----------------------------------
log "Salvando imagens Docker (docker save)..."
IMAGENS=(
  "${COMPOSE_PROJECT_NAME}-backend"
  "${COMPOSE_PROJECT_NAME}-frontend"
  "${COMPOSE_PROJECT_NAME}-historian-api"
  "${COMPOSE_PROJECT_NAME}-historian-frontend"
  "${COMPOSE_PROJECT_NAME}-historian-collector"
)
docker save -o "$OUT_DIR/imagens.tar" "${IMAGENS[@]}"

# --- 2. Dumps dos bancos de dados ------------------------------------------
log "Gerando dump do banco do dashboard (forno_db)..."
docker exec "${COMPOSE_PROJECT_NAME}-postgres-1" pg_dump -U forno_app -d forno_db > "$OUT_DIR/forno_db.sql"

log "Gerando dump do banco do Historian (wtecc_historian)..."
docker exec "${COMPOSE_PROJECT_NAME}-historian-db-1" pg_dump -U wtecc -d wtecc_historian > "$OUT_DIR/historian_db.sql"

# --- 3. Dados do InfluxDB (armazenamento em arquivo puro — copia direto) --
log "Copiando dados do InfluxDB..."
INFLUX_VOLUME="${COMPOSE_PROJECT_NAME}_influxdb_data"
# --user evita que o arquivo saia com dono "root" (padrão do container) —
# sem isso, o próprio usuário que rodou o backup não consegue nem trocar a
# permissão desse arquivo depois (só o root pode).
docker run --rm --user "$(id -u):$(id -g)" \
  -v "${INFLUX_VOLUME}:/data:ro" \
  -v "$OUT_DIR:/backup" \
  alpine tar czf /backup/influxdb_data.tar.gz -C /data .

# --- 4. A pasta do projeto inteira (código + docker-compose.yml + .env) --
# Inclui os .env ATUAIS de propósito — o clonar-instalacao.sh precisa deles
# pra conseguir autenticar e trocar as credenciais na primeira etapa da
# reconfiguração. Por isso este pacote inteiro deve ser tratado como
# CONFIDENCIAL (mesmo nível de um arquivo de senhas) até ser usado.
log "Empacotando o código do projeto..."
PROJETO_NOME="$(basename "$(pwd)")"
tar czf "$OUT_DIR/projeto.tar.gz" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  -C .. "$PROJETO_NOME"

# --- 5. Manifesto ------------------------------------------------------
cat > "$OUT_DIR/MANIFEST.txt" <<EOF
Backup gerado em: $(date '+%Y-%m-%d %H:%M:%S')
Máquina de origem: $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))
Projeto compose: $COMPOSE_PROJECT_NAME

Conteúdo:
  projeto.tar.gz          - código-fonte + docker-compose.yml + .env atuais
  imagens.tar              - imagens Docker já buildadas e testadas
  forno_db.sql             - dump do banco do dashboard
  historian_db.sql         - dump do banco do Historian
  influxdb_data.tar.gz     - dados brutos do InfluxDB

*** ATENÇÃO — ESTE PACOTE É CONFIDENCIAL ***
Ele contém as senhas/tokens desta instalação (dentro dos .env, para uso
único durante a etapa de reconfiguração) e todo o histórico de dados
coletado até agora. Transfira só por canal seguro (rede local, pendrive
pessoal) e apague o pacote de qualquer lugar temporário depois de usado.

Para clonar numa máquina nova (com Docker já instalado):
  1. Transfira esta pasta inteira para a máquina de destino.
  2. Rode: ./clonar-instalacao.sh /caminho/para/$(basename "$OUT_DIR")
     (o script clonar-instalacao.sh está dentro de projeto.tar.gz, em
     scripts/clonar-instalacao.sh — extraia o projeto primeiro ou rode
     direto de dentro dele)
EOF

cp scripts/clonar-instalacao.sh "$OUT_DIR/clonar-instalacao.sh"
chmod +x "$OUT_DIR/clonar-instalacao.sh"

# tranca tudo pro dono só (o pacote contém senhas reais desta instalação)
chmod -R go-rwx "$OUT_DIR"

TAMANHO="$(du -sh "$OUT_DIR" | cut -f1)"
log "Backup concluído: $OUT_DIR ($TAMANHO)"
cat <<EOF

  Pacote pronto em: $OUT_DIR

  Transfira essa pasta inteira pra máquina do cliente (scp, pendrive, etc)
  e rode, na máquina de destino:

    ./clonar-instalacao.sh $OUT_DIR

  Lembre-se: este pacote contém as senhas atuais desta instalação. Trate
  como confidencial e apague de qualquer lugar temporário após o uso.

EOF
