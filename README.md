# Forno Dashboard — Sistema Marz Forno 01 de Bolachas

Sistema de monitoramento e histórico de sensores de um forno industrial: dashboard em tempo real, gráficos com múltiplas variáveis, relatórios em PDF/CSV, OEE por turno, alarmes e controle de acesso por perfil de usuário.

Este README cobre o essencial para rodar e entender o projeto. A documentação técnica completa (arquitetura, pacotes, estrutura de pastas, descrição de cada arquivo/função) está em `Forno_Dashboard_Documentacao_Tecnica.docx`.

## Arquitetura

- **Frontend:** React 18 + Vite, na porta `3000`.
- **Backend:** Node.js + Express, na porta `5000`.
- **Bancos de dados:**
  - **PostgreSQL** — usuários, configurações de turnos/sensores, layout do dashboard, histórico de alarmes.
  - **InfluxDB 3** — leituras de sensores em série temporal (tabela `Variaveis`).
- **Autenticação:** JWT (`jsonwebtoken`) + senhas com hash `bcrypt`. Perfis: `administrador`, `supervisor`, `operador`.

## Como rodar

1. Instale o PostgreSQL e o InfluxDB 3 e tenha-os rodando (o backend cria as tabelas do Postgres automaticamente na primeira execução).
2. Copie `backend/.env.example` para `backend/.env` e preencha com os valores reais (ver seção abaixo).
3. Copie `frontend/.env.example` para `frontend/.env` e ajuste `VITE_API_URL` se necessário.
4. Dê um duplo clique em `start.bat` na raiz do projeto — ele instala as dependências (se ainda não instaladas), inicia backend e frontend em janelas separadas, e abre o navegador automaticamente em `http://localhost:3000`.

Alternativa manual:
```
cd backend && npm install && npm start
cd frontend && npm install && npm run dev
```

**Importante:** o backend não tem hot-reload. Sempre que `backend/server.js` (ou qualquer rota) for alterado, é preciso reiniciar o processo do backend para as mudanças valerem. O frontend também precisa ser reiniciado quando o `frontend/.env` é alterado (o Vite só lê o `.env` na inicialização).

## Variáveis de ambiente

Veja `backend/.env.example` e `frontend/.env.example` para a lista completa. Resumo:

| Variável | Onde | Descrição |
|---|---|---|
| `PORT` | backend | Porta do Express (padrão 5000) |
| `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | backend | Conexão com o PostgreSQL |
| `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_BUCKET` | backend | Conexão com o InfluxDB 3 |
| `JWT_SECRET` | backend | Chave usada para assinar os tokens de login |
| `VITE_API_URL` | frontend | URL base do backend, usada por `frontend/src/api.js` |

## Perfis de usuário e acesso

- **operador** (padrão): acesso ao dashboard principal.
- **supervisor** e **administrador**: acesso adicional às telas de configuração (Turnos e Variáveis/Sensores).
- **administrador**: também pode criar novos usuários.
- Enquanto não houver nenhum usuário cadastrado, o primeiro cadastro é livre e vira administrador automaticamente (modo bootstrap).

## Estrutura de pastas (resumo)

```
backend/
  server.js          # rotas de layout, turnos, sensores, alarmes, OEE
  db.js              # conexão única com o PostgreSQL
  routes/auth.js      # login, registro, status
  routes/influx.js     # consultas ao InfluxDB (uma ou múltiplas variáveis)
frontend/
  src/App.jsx          # componente raiz, navegação, layout de gráficos
  src/api.js           # client HTTP centralizado (base URL + token automático)
  src/ChartCard.jsx     # gráfico (Trend) com zoom, exportação CSV/PDF
  src/Login.jsx, UserSwitchModal.jsx  # autenticação
  src/ConfigView.jsx, SensorConfigView.jsx  # telas de configuração (supervisor/admin)
  src/OeeView.jsx, AlarmModal.jsx     # OEE e histórico de alarmes
start.bat              # launcher de um clique (backend + frontend + navegador)
```

Pastas legadas (`_to_delete/`, `frontend/src/OLD`, `frontend/src/components`, `frontend/src/utils`) ainda existem no projeto e podem ser apagadas manualmente — não fazem mais parte do sistema em uso.

## Pendências conhecidas

- Dados de OEE dos Turnos A e C ainda são simulados (mockados), não calculados a partir do histórico real.
- Eventos de alarme não são registrados automaticamente em `/api/alarms` quando um valor sai da faixa em `ChartCard.jsx` — a rota existe, mas nada dispara o registro hoje.
- `/api/dashboard/layout` e `/api/alarms` são rotas abertas de propósito (sem exigir login), pensadas para uso em rede interna.
