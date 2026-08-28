# Forno Dashboard — Sistema Marz Forno 01 de Bolachas

Dashboard de monitoramento e histórico de sensores de um forno industrial: gráficos
em tempo real, relatórios em PDF/CSV, OEE por turno, paradas, perdas em kg,
relatório executivo, alarmes e controle de acesso por perfil de usuário.

Este é o projeto de **visualização**. A coleta de dados do CLP é feita por um
projeto separado, o [Wtecc Historian](https://github.com/ronthel/wtecc-historian)
— pode rodar nesta mesma máquina ou em outro servidor; este dashboard só
precisa conseguir alcançá-lo pela rede (InfluxDB + API de tags).

## Arquitetura

- **Frontend:** React 18 + Vite, na porta `3000`.
- **Backend:** Node.js + Express, na porta `5000`.
- **PostgreSQL** (próprio deste projeto): usuários, turnos, configuração de
  sensores/perdas, layout do dashboard, histórico de alarmes/auditoria.
- **InfluxDB 3** (do projeto Wtecc Historian): leituras de sensores em série
  temporal (tabela `tag_events`) — só leitura a partir daqui.
- **API do Wtecc Historian**: usada pra listar as tags/variáveis cadastradas
  nas telas de configuração (Sensores, Perdas).
- **Autenticação:** JWT (`jsonwebtoken`) + senhas com hash `bcrypt`. Perfis:
  `administrador`, `supervisor`, `operador`.

## Como instalar (produção, Docker)

Pré-requisito: o [Wtecc Historian](https://github.com/ronthel/wtecc-historian)
já instalado e rodando (mesma máquina ou outro servidor) — guarde os valores
que o `install.sh` dele imprime no final (INFLUX_TOKEN, IP/porta do InfluxDB,
IP/porta da API, senha do papel "viewer").

```
git clone git@github.com:ronthel/forno-dashboard.git
cd forno-dashboard
./install.sh
```

O script pergunta o IP desta máquina e como chegar no Historian, gera as
credenciais deste projeto, sobe Postgres/backend/frontend via Docker Compose
e mostra a URL final.

## Desenvolvimento local (sem Docker)

1. Tenha um PostgreSQL rodando e um Wtecc Historian acessível (local ou remoto).
2. Copie `backend/.env.example` para `backend/.env` e preencha com os valores reais.
3. Copie `frontend/.env.example` para `frontend/.env` e ajuste `VITE_API_URL` se necessário.
4. `cd backend && npm install && npm start`
5. `cd frontend && npm install && npm run dev`

**Importante:** o backend não tem hot-reload — reinicie o processo após
alterar `backend/server.js` ou qualquer rota. O frontend só lê `.env` na
inicialização, então também precisa reiniciar após alterá-lo.

## Variáveis de ambiente

Veja `backend/.env.example` e `frontend/.env.example` para a lista completa. Resumo:

| Variável | Onde | Descrição |
|---|---|---|
| `PORT` | backend | Porta do Express (padrão 5000) |
| `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | backend | Conexão com o PostgreSQL deste projeto |
| `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_BUCKET` | backend | Conexão com o InfluxDB do projeto Historian (local ou remoto) |
| `HISTORIAN_API_URL`, `HISTORIAN_VIEWER_PASSWORD` | backend | Conexão com a API do projeto Historian, pra listar tags cadastradas |
| `JWT_SECRET` | backend | Chave usada para assinar os tokens de login |
| `VITE_API_URL` | frontend | URL base do backend, usada por `frontend/src/api.js` |

## Perfis de usuário e acesso

- **operador** (padrão): acesso ao dashboard principal.
- **supervisor** e **administrador**: acesso adicional às telas de configuração
  (Turnos, Sensores/Variáveis, Perdas, OEE).
- **administrador**: também pode criar novos usuários.
- Enquanto não houver nenhum usuário cadastrado, o primeiro cadastro é livre e
  vira administrador automaticamente (modo bootstrap).

## Estrutura de pastas (resumo)

```
backend/
  server.js            # rotas de layout, turnos, sensores, alarmes, OEE, paradas, perdas
  db.js                # conexão única com o PostgreSQL
  routes/auth.js       # login, registro, status
  routes/influx.js     # consultas ao InfluxDB (Historian)
frontend/
  src/App.jsx                    # componente raiz, navegação, layout
  src/api.js                     # client HTTP centralizado (base URL + token automático)
  src/ChartCard.jsx               # gráfico (Trend) com zoom, exportação CSV/PDF
  src/OeeView.jsx, OeeConfigView.jsx      # OEE por turno
  src/ParadasView.jsx                    # paradas programadas/não programadas
  src/PerdasView.jsx, PerdasConfigView.jsx  # perdas em kg por turno
  src/RelatorioExecutivoView.jsx          # relatório executivo (OEE x meta, tendência semanal)
docker-compose.yml     # postgres + backend + frontend
install.sh             # instalação Docker completa (produção)
```
