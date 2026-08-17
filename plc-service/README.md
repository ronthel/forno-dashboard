# plc-service — Piloto Forno (Projeto Parati)

Serviço Python independente que lê tags do PLC (Logix Echo, via `pycomm3`)
periodicamente e grava os valores no InfluxDB 3 Core, que o backend do
Forno Dashboard já consome. Roda separado do backend/frontend Node — não faz
parte do processo Express, é um processo próprio.

Fluxo: **PLC (Logix Echo) → `plc_to_influx.py` → InfluxDB 3 Core → Dashboard**

## Primeira instalação

```
cd plc-service
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

Depois, abra `.env` e preencha `INFLUX_TOKEN` (mesmo token usado em
`backend\.env`, no `INFLUX_TOKEN` de lá).

Confira também `PLC_PATH` no topo de `plc_to_influx.py` — é o IP/slot do PLC,
não é segredo, por isso fica direto no código.

## Rodar manualmente

```
venv\Scripts\python plc_to_influx.py
```

Para testar só a conexão com o PLC antes de rodar o pipeline completo:

```
venv\Scripts\python teste_plc.py
```

Ícone de status na bandeja (opcional, mostra verde/vermelho/cinza conforme a
saúde do pipeline):

```
venv\Scripts\pythonw teste_plc.py
venv\Scripts\pythonw tray_status.py
```

## Rodar junto com o resto do sistema

O `start.bat` na raiz do projeto (`forno-dashboard\start.bat`) já sobe o
InfluxDB, este pipeline, o ícone de bandeja e o backend/frontend do
dashboard juntos, num só clique. Use `stop.bat` para encerrar tudo.

## Arquivos

- `plc_to_influx.py` — o pipeline em si (lê o PLC, escreve no InfluxDB, tem
  watchdog que reinicia a conexão se travar).
- `teste_plc.py` — teste isolado de leitura do PLC, sem gravar nada.
- `tray_status.py` — ícone de bandeja com o status do pipeline.
- `requirements.txt` — dependências Python.
- `.env` — token/URL/bucket do InfluxDB (não versionar; copiado de `.env.example`).
- `logs/` — logs rotativos de `plc_to_influx.py` e `tray_status.py` (criados
  automaticamente na primeira execução).
