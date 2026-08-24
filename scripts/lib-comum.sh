#!/usr/bin/env bash
# Funções compartilhadas entre backup-instalacao.sh e clonar-instalacao.sh.
# (install.sh continua com sua própria cópia dessas funções de propósito —
# já está testado e validado, e não é o caso de arriscar mexer nele agora.)

log()  { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErro: %s\033[0m\n' "$1"; exit 1; }

gen_hex()  { openssl rand -hex "$1"; }
gen_pass() { openssl rand -base64 18 | tr -d '=+/\n'; }

# Espera um container do compose ficar "healthy" (usa o healthcheck definido
# no docker-compose.yml). $1 = nome do projeto compose, $2 = nome do serviço.
aguardar_healthy() {
  local projeto="$1" servico="$2"
  for _ in $(seq 1 30); do
    local status
    status="$(docker inspect -f '{{.State.Health.Status}}' "${projeto}-${servico}-1" 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && return 0
    sleep 2
  done
  fail "Serviço '$servico' não ficou saudável a tempo."
}

# Pergunta os dados do CLP (nome, IP, fabricante, slot/rack) e define as
# variáveis globais PLC_NAME, PLC_IP, PLC_BRAND, PLC_MODEL, PLC_DRIVER,
# PLC_SLOT_SQL, PLC_RACK_SQL — igual ao passo 2 do install.sh.
prompt_clp() {
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
}

# Grava as senhas dos 3 papéis do Historian (admin/operator/viewer) no banco,
# via hash bcrypt gerado dentro do container da API (mesma lib que ele usa
# pra conferir login, evitando qualquer incompatibilidade de hash).
configurar_senhas_historian() {
  local historian_api_container="$1" historian_db_container="$2"
  local admin_pw="$3" operator_pw="$4" viewer_pw="$5"

  local role_sql
  role_sql="$(docker exec "$historian_api_container" python3 -c "
import bcrypt
pwds = {'admin': '$admin_pw', 'operator': '$operator_pw', 'viewer': '$viewer_pw'}
for role, pw in pwds.items():
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
    print(f\"INSERT INTO role_credentials (role, password_hash) VALUES ('{role}', '{h}') ON CONFLICT (role) DO UPDATE SET password_hash = EXCLUDED.password_hash;\")
")"
  echo "$role_sql" | docker exec -i "$historian_db_container" psql -U wtecc -d wtecc_historian >/dev/null
}
