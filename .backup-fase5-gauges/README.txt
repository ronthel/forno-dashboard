Backup pré-Fase5 (gauges no formato do print de referência).
Pra reverter: copiar OeeView.jsx.bak de volta pra frontend/src/OeeView.jsx,
apagar frontend/src/Gauges.jsx, e rodar:
  docker compose build frontend && docker compose up -d frontend
