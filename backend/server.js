const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { InfluxDBClient } = require('@influxdata/influxdb3-client');
require('dotenv').config();

// Middleware: exige um token de login válido pertencente a um usuário com um
// dos perfis permitidos. Usado para proteger as rotas que ALTERAM configurações
// (turnos, sensores) — as rotas de leitura continuam abertas para qualquer
// usuário logado, pois o dashboard principal depende delas.
const requireRole = (allowedRoles) => (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Login necessário para esta ação.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
};

// Middleware: exige só um login válido, de qualquer papel — usado nas rotas
// de layout do dashboard, que agora são pessoais por usuário (cada um só
// enxerga e só sobrescreve o próprio layout, nunca o de outra pessoa).
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Login necessário para esta ação.' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
};

// Inicialização do Express
const app = express();
app.use(cors());
app.use(express.json());

// Configuração do Cliente InfluxDB 3
// Sem token hardcoded como fallback — se INFLUX_TOKEN não estiver no .env,
// o app deve falhar de forma visível em vez de usar uma credencial escrita no código.
const hostUrl = process.env.INFLUX_URL || 'http://localhost:8181';
const formattedHost = hostUrl.startsWith('http') ? hostUrl : `http://${hostUrl}`;

if (!process.env.INFLUX_TOKEN) {
  console.warn('[Aviso] INFLUX_TOKEN não definido no .env — as consultas ao InfluxDB vão falhar até isso ser configurado.');
}

const influxDB = new InfluxDBClient({
  host: formattedHost,
  token: process.env.INFLUX_TOKEN,
  database: process.env.INFLUX_BUCKET || 'forno'
});

// Conexão única com o PostgreSQL, compartilhada com routes/auth.js (ver db.js)
const db = require('./db');
const { logAudit } = require('./audit');

// Criar tabelas no PostgreSQL ao iniciar
async function initPostgres() {
  try {
    await db.query(`
      -- Cada usuário pode ter vários dashboards nomeados (ex: "Temperaturas
      -- do Forno", "Pressões") — substitui a antiga dashboard_layouts (um
      -- layout único por pessoa, versionado por INSERT). ON DELETE CASCADE:
      -- excluir um usuário leva os dashboards dele junto.
      CREATE TABLE IF NOT EXISTS dashboards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS alarm_history (
        id SERIAL PRIMARY KEY,
        field_name VARCHAR(50) NOT NULL,
        value_read NUMERIC NOT NULL,
        limit_type VARCHAR(10) NOT NULL,
        limit_value NUMERIC NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Ciclo de vida do alarme: ATIVO (condição ainda fora da faixa) até
      -- NORMALIZADO (valor voltou ao normal), com reconhecimento (quem e
      -- quando) independente disso — um alarme pode estar ativo e já
      -- reconhecido, ativo e não reconhecido, ou normalizado.
      ALTER TABLE alarm_history ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ATIVO';
      ALTER TABLE alarm_history ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE alarm_history ADD COLUMN IF NOT EXISTS acknowledged_by VARCHAR(50);
      ALTER TABLE alarm_history ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP;
      ALTER TABLE alarm_history ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMP;
      -- Só preenchido quando o alarme foi normalizado manualmente por um
      -- supervisor/administrador na Central de Alarmes (não pelo próprio
      -- sistema detectando o valor de volta à faixa).
      ALTER TABLE alarm_history ADD COLUMN IF NOT EXISTS cleared_by VARCHAR(50);

      CREATE TABLE IF NOT EXISTS turnos_config (
        turno_key VARCHAR(50) PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        hora_inicio VARCHAR(10) NOT NULL,
        hora_fim VARCHAR(10) NOT NULL,
        meta_oee NUMERIC(5,2) NOT NULL
      );

      -- Ponto de partida do "Zerar" (ver POST /api/oee/reset) — agora POR
      -- TURNO, não mais um único valor global em oee_config: zerar só afeta
      -- o turno que estava ativo no momento do reset, os outros dois turnos
      -- (e o gráfico de tendência, que nunca olha pra esta coluna) continuam
      -- intactos. TIMESTAMPTZ pelo mesmo motivo do antigo oee_config.zerado_em
      -- (backend em America/Sao_Paulo, Postgres em UTC).
      ALTER TABLE turnos_config ADD COLUMN IF NOT EXISTS zerado_em TIMESTAMPTZ;

      -- Mapeamento de variáveis do OEE: em vez de nomes de tag fixos no
      -- código, cada papel (tempo rodando, contagem total, contagem de
      -- refugo, status da máquina, tempo de ciclo real) aponta pra uma das
      -- variáveis já cadastradas em sensores_config/InfluxDB — configurável
      -- pela tela, sem precisar mexer em código quando o CLP mudar de tag.
      -- Linha única (id sempre 1, travado pelo CHECK).
      -- Performance do OEE aqui é medida em pacotes/minuto (contagem de
      -- pacotes produzidos), não tempo de ciclo — combina melhor com o
      -- processo real: sai bolacha do forno, empacota, e o sensor conta
      -- pacote pronto no fim do empacotamento.
      CREATE TABLE IF NOT EXISTS oee_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        field_tempo_rodando TEXT,
        field_contagem_total TEXT,
        field_contagem_refugo TEXT,
        field_maquina_rodando TEXT,
        field_velocidade_nominal TEXT,
        -- Velocidade real calculada pelo próprio CLP (pacotes/min) — quando
        -- mapeada, substitui o cálculo por delta da Contagem Total (que
        -- ainda é usado como reserva se essa variável não estiver mapeada).
        field_velocidade_real TEXT,
        -- Reserva, usada só se field_velocidade_nominal não estiver mapeada
        -- (ou sem leitura ainda) — permite configurar um número fixo
        -- enquanto o CLP não tiver essa variável pronta.
        velocidade_nominal_ppm NUMERIC NOT NULL DEFAULT 50,
        tempo_planejado_seg NUMERIC NOT NULL DEFAULT 28800,
        -- Ponto de partida pro cálculo dos contadores — tudo que o CLP já
        -- tinha contado ANTES desse instante é ignorado. Existe pra dar um
        -- "começa do zero agora" de verdade, sem depender de mexer no CLP
        -- (os contadores lá continuam crescendo pra sempre, de propósito).
        -- TIMESTAMPTZ de propósito (não TIMESTAMP): o backend roda com
        -- TZ=America/Sao_Paulo mas o Postgres roda em UTC — sem o fuso
        -- explícito na coluna, o valor lido de volta no Node vinha
        -- deslocado 3h, fazendo o sistema achar que o reset ainda não tinha
        -- acontecido (parecia estar no futuro) e zerava tudo.
        zerado_em TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT oee_config_single_row CHECK (id = 1)
      );

      -- Catálogo de motivos de parada — cada um já marcado como programada
      -- (limpeza, setup, manutenção preventiva...) ou não programada (quebra,
      -- falta de material...). Isso decide se o tempo entra no desconto do
      -- "Tempo Planejado" da Disponibilidade ou não.
      CREATE TABLE IF NOT EXISTS motivos_parada (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL UNIQUE,
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('programada','nao_programada')),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Eventos de parada — abertos/fechados automaticamente por um processo
      -- que observa a tag "Máquina Rodando" (ver detectorDeParadas), e depois
      -- classificados por um operador (motivo + justificativa). Sem turno_key
      -- de propósito: qual turno cada parada pertence é decidido na hora da
      -- consulta, comparando iniciado_em com a janela do turno — assim, se a
      -- escala de turnos mudar depois, o histórico de paradas não fica órfão.
      CREATE TABLE IF NOT EXISTS paradas (
        id SERIAL PRIMARY KEY,
        iniciado_em TIMESTAMPTZ NOT NULL,
        finalizado_em TIMESTAMPTZ,
        motivo_id INTEGER REFERENCES motivos_parada(id),
        justificativa TEXT,
        classificado_por_id INTEGER,
        classificado_por_username VARCHAR(50),
        classificado_em TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_paradas_iniciado_em ON paradas(iniciado_em);
      CREATE INDEX IF NOT EXISTS idx_paradas_finalizado_em ON paradas(finalizado_em);

      -- Estado do detector automático de paradas (linha única) — até onde do
      -- histórico da tag "Máquina Rodando" já foi processado, e qual era o
      -- último valor conhecido (pra saber se a próxima leitura é uma
      -- transição de verdade ou só repetição do mesmo estado).
      CREATE TABLE IF NOT EXISTS parada_detector_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        ultimo_processado_em TIMESTAMPTZ,
        ultimo_valor_conhecido BOOLEAN,
        CONSTRAINT parada_detector_single_row CHECK (id = 1)
      );

      INSERT INTO motivos_parada (nome, tipo) VALUES
        ('Limpeza', 'programada'),
        ('Setup / Troca de Produto', 'programada'),
        ('Manutenção Preventiva', 'programada'),
        ('Troca de Turno', 'programada'),
        ('Falta de Material', 'nao_programada'),
        ('Quebra / Manutenção Corretiva', 'nao_programada'),
        ('Falta de Operador', 'nao_programada'),
        ('Ajuste de Qualidade', 'nao_programada'),
        ('Outros', 'nao_programada')
      ON CONFLICT (nome) DO NOTHING;

      CREATE TABLE IF NOT EXISTS sensores_config (
        field_name VARCHAR(100) PRIMARY KEY,
        descricao VARCHAR(200),
        unidade VARCHAR(20),
        -- Sem limite de precisão de propósito: NUMERIC(10,2) (usado antes)
        -- estourava ("numeric field overflow") em variáveis de contador
        -- cumulativo (ex: tempo rodando do OEE), onde um limite máximo de
        -- 1 bilhão+ é normal.
        min_limit NUMERIC,
        max_limit NUMERIC,
        cor VARCHAR(20),
        fator_correcao NUMERIC(10,4),
        tipo_alarme VARCHAR(50)
      );

      -- Variável "desativada" pára de ser monitorada (some do picker do PLC,
      -- some da lista de coleta do plc-service) mas o histórico já gravado no
      -- InfluxDB continua intacto — soft delete, nunca apagamos a linha.
      ALTER TABLE sensores_config ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    // Duas variáveis com a mesma descrição confundem o picker de seleção do
    // dashboard (fica impossível saber qual é qual na hora de montar um
    // gráfico) — trava no banco, não só no frontend, para valer mesmo se
    // alguém gravar direto via API. Ignora maiúsc./minúsc. e espaços nas
    // pontas (evita duplicata tipo "Zona 1" vs "zona 1 "), e permite várias
    // linhas com descrição vazia/nula (índice parcial).
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sensores_config_descricao_unique
      ON sensores_config (lower(trim(descricao)))
      WHERE descricao IS NOT NULL AND descricao <> '';
    `);
    console.log('[PostgreSQL] Conectado e tabelas prontas.');
  } catch (err) {
    console.warn('[PostgreSQL Aviso] Não foi possível conectar:', err.message);
  }
}
initPostgres();

// --- Integração com o plc-service (pipeline PLC -> InfluxDB) ---
// O plc-service roda como um processo Python separado, na mesma máquina, e
// expõe uma pequena API local (só em 127.0.0.1) para: (1) o backend consultar
// quais tags o PLC tem disponíveis (para o picker de variáveis), e (2) o
// backend avisar o pipeline de quais variáveis estão ativas, via um arquivo
// combinado entre os dois (monitored_tags.json) em vez de uma segunda conexão
// ao PLC ou de dar ao Python acesso direto ao PostgreSQL.
// Cliente do Wtecc Historian — ele é quem sabe de verdade quais tags
// existem e estão sendo coletadas do CLP agora (o plc-service antigo, que
// expunha uma API local de descoberta, está desativado). Autentica com o
// papel "viewer" (só leitura, suficiente pra listar tags) e cacheia o token
// até perto de expirar.
const HISTORIAN_API_URL = process.env.HISTORIAN_API_URL || 'http://historian-api:8000';
const HISTORIAN_VIEWER_PASSWORD = process.env.HISTORIAN_VIEWER_PASSWORD;

let historianTokenCache = { token: null, expiresAt: 0 };

async function getHistorianToken() {
  if (historianTokenCache.token && Date.now() < historianTokenCache.expiresAt - 30000) {
    return historianTokenCache.token;
  }
  if (!HISTORIAN_VIEWER_PASSWORD) {
    throw new Error('HISTORIAN_VIEWER_PASSWORD não configurado no .env do backend');
  }
  const loginRes = await fetch(`${HISTORIAN_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'viewer', password: HISTORIAN_VIEWER_PASSWORD })
  });
  if (!loginRes.ok) {
    throw new Error(`login no Historian falhou: HTTP ${loginRes.status}`);
  }
  const loginData = await loginRes.json();
  historianTokenCache = { token: loginData.token, expiresAt: new Date(loginData.expires_at).getTime() };
  return loginData.token;
}

// Lista as tags REGISTRADAS no Historian (area=registered exclui as tags de
// gatilho, que não fazem sentido aparecer nesse picker) — usada por
// GET /api/plc/tags para alimentar o painel "Adicionar nova variável".
async function fetchHistorianRegisteredTags() {
  const token = await getHistorianToken();
  const searchRes = await fetch(`${HISTORIAN_API_URL}/tags/search?area=registered&limit=500`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!searchRes.ok) {
    throw new Error(`consulta de tags no Historian falhou: HTTP ${searchRes.status}`);
  }
  const searchData = await searchRes.json();
  return (searchData.items || []).map((t) => ({ tag_name: t.name }));
}

// Remove uma variável desativada de qualquer gráfico onde ela apareça em
// QUALQUER dashboard de QUALQUER usuário — chamado só ao DESATIVAR (reativar
// não devolve a variável aos gráficos automaticamente, o usuário adiciona de
// novo se quiser). Se um gráfico ficar sem nenhuma variável depois da
// remoção, o gráfico inteiro é removido (não faz sentido um card vazio).
//
// Cada usuário pode ter vários dashboards nomeados (ver ROTAS DE DASHBOARDS
// abaixo) — precisa varrer todos, de todos os usuários, não só "o" dashboard
// de alguém.
async function removeFieldFromSavedLayout(fieldName) {
  try {
    const allDashboards = await db.query('SELECT id, config FROM dashboards');

    let anyChanged = false;
    for (const row of allDashboards.rows) {
      const stored = row.config;
      const charts = Array.isArray(stored) ? stored : (stored?.charts || []);
      if (!Array.isArray(charts) || charts.length === 0) continue;

      let changed = false;
      const updatedCharts = charts
        .map((c) => {
          if (!Array.isArray(c.fields) || !c.fields.includes(fieldName)) return c;
          changed = true;
          return {
            ...c,
            fields: c.fields.filter((f) => f !== fieldName),
            hiddenFields: Array.isArray(c.hiddenFields) ? c.hiddenFields.filter((f) => f !== fieldName) : c.hiddenFields
          };
        })
        .filter((c) => !Array.isArray(c.fields) || c.fields.length > 0);

      if (!changed) continue;

      const newConfig = Array.isArray(stored) ? updatedCharts : { ...stored, charts: updatedCharts };
      await db.query(
        'UPDATE dashboards SET config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(newConfig), row.id]
      );
      anyChanged = true;
    }

    return anyChanged;
  } catch (err) {
    console.error('Erro ao remover variável desativada dos dashboards salvos:', err.message);
    return false;
  }
}

// Importação das rotas do InfluxDB
const influxRoutes = require('./routes/influx');
app.use('/api/influx', influxRoutes);

// Importação das rotas de autenticação (login, registro)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// --- ROTAS DE DASHBOARDS (POSTGRESQL) ---
// Cada usuário pode ter VÁRIOS dashboards nomeados (ex: "Temperaturas do
// Forno", "Pressões") — não é mais um layout único por pessoa. Cada linha
// de `dashboards` é uma tela: id, dono (user_id), nome, e `config` (jsonb)
// guardando { charts, refreshInterval, timeRange }, igual ao formato antigo
// de charts_config. Atualiza em cima da mesma linha (não é mais "sempre
// INSERT" como o extinto dashboard_layouts) — cada tela tem sua identidade
// própria (o id), então não precisa de histórico de versões pra saber qual
// é qual.
//
// Todas exigem login e sempre filtram por req.user.id — ninguém enxerga ou
// altera o dashboard de outra pessoa.

// Garante que o usuário sempre tenha pelo menos um dashboard pra abrir —
// cria um "Principal" vazio na primeira vez que a pessoa acessa e ainda não
// tem nenhum.
async function ensureDefaultDashboard(userId) {
  const existing = await db.query(
    'SELECT id, name, config, updated_at FROM dashboards WHERE user_id = $1 ORDER BY name',
    [userId]
  );
  if (existing.rows.length > 0) return existing.rows;

  const created = await db.query(
    `INSERT INTO dashboards (user_id, name, config)
     VALUES ($1, 'Principal', $2)
     RETURNING id, name, config, updated_at`,
    [userId, JSON.stringify({ charts: [], refreshInterval: 5000, timeRange: '1h' })]
  );
  return created.rows;
}

// Lista os dashboards do usuário logado (só id/nome/data — sem o conteúdo
// completo, que só é buscado quando um deles é efetivamente aberto).
app.get('/api/dashboards', requireAuth, async (req, res) => {
  try {
    const rows = await ensureDefaultDashboard(req.user.id);
    res.json(rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at })));
  } catch (err) {
    console.error('Erro ao listar dashboards:', err);
    res.status(500).json({ error: 'Erro ao listar dashboards' });
  }
});

// Cria um dashboard novo, vazio, com o nome informado.
app.post('/api/dashboards', requireAuth, async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe um nome para o dashboard.' });
  try {
    const result = await db.query(
      `INSERT INTO dashboards (user_id, name, config)
       VALUES ($1, $2, $3)
       RETURNING id, name, config, updated_at`,
      [req.user.id, name, JSON.stringify({ charts: [], refreshInterval: 5000, timeRange: '1h' })]
    );
    const row = result.rows[0];
    logAudit({
      userId: req.user.id, username: req.user.username, role: req.user.role,
      action: 'criou dashboard', details: { name }
    });
    res.status(201).json({ id: row.id, name: row.name, ...row.config });
  } catch (err) {
    console.error('Erro ao criar dashboard:', err);
    res.status(500).json({ error: 'Erro ao criar dashboard' });
  }
});

// Busca um dashboard específico do usuário logado (404 se não existir OU
// pertencer a outra pessoa — mesma resposta pros dois casos, de propósito,
// pra não revelar se o id existe mas é de outro usuário).
app.get('/api/dashboards/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, config, updated_at FROM dashboards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Dashboard não encontrado.' });
    const row = result.rows[0];
    res.json({ id: row.id, name: row.name, ...row.config });
  } catch (err) {
    console.error('Erro ao buscar dashboard:', err);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

// Atualiza o conteúdo (gráficos/preferências) e/ou o nome de um dashboard.
app.put('/api/dashboards/:id', requireAuth, async (req, res) => {
  const { charts, refreshInterval, timeRange, name } = req.body;
  try {
    const owns = await db.query('SELECT id FROM dashboards WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (owns.rows.length === 0) return res.status(404).json({ error: 'Dashboard não encontrado.' });

    const trimmedName = typeof name === 'string' ? name.trim() : null;
    if (trimmedName !== null && !trimmedName) {
      return res.status(400).json({ error: 'O nome do dashboard não pode ficar vazio.' });
    }

    const result = await db.query(
      `UPDATE dashboards SET config = $1, updated_at = CURRENT_TIMESTAMP
       ${trimmedName ? ', name = $3' : ''}
       WHERE id = $2 RETURNING id, name`,
      trimmedName
        ? [JSON.stringify({ charts, refreshInterval, timeRange }), req.params.id, trimmedName]
        : [JSON.stringify({ charts, refreshInterval, timeRange }), req.params.id]
    );

    logAudit({
      userId: req.user.id, username: req.user.username, role: req.user.role,
      action: 'salvou dashboard',
      details: { dashboardId: req.params.id, name: result.rows[0].name, totalGraficos: Array.isArray(charts) ? charts.length : 0 }
    });

    res.json({ message: 'Dashboard salvo!' });
  } catch (err) {
    console.error('Erro ao salvar dashboard:', err);
    res.status(500).json({ error: 'Erro ao salvar dashboard' });
  }
});

// Exclui um dashboard — nunca deixa o usuário sem nenhum (a tela sempre
// precisa ter pelo menos um dashboard pra abrir).
app.delete('/api/dashboards/:id', requireAuth, async (req, res) => {
  try {
    const countRes = await db.query('SELECT count(*) FROM dashboards WHERE user_id = $1', [req.user.id]);
    if (Number(countRes.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Não é possível excluir o único dashboard.' });
    }
    const result = await db.query(
      'DELETE FROM dashboards WHERE id = $1 AND user_id = $2 RETURNING name',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Dashboard não encontrado.' });

    logAudit({
      userId: req.user.id, username: req.user.username, role: req.user.role,
      action: 'excluiu dashboard', details: { name: result.rows[0].name }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir dashboard:', err);
    res.status(500).json({ error: 'Erro ao excluir dashboard' });
  }
});

// --- ROTAS DE CONFIGURAÇÃO DE TURNOS ---
app.get('/api/config/turnos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM turnos_config');
    const configs = {};
    result.rows.forEach(row => {
      configs[row.turno_key] = {
        nome: row.nome,
        inicio: row.hora_inicio,
        fim: row.hora_fim,
        metaOee: Number(row.meta_oee)
      };
    });
    res.json(configs);
  } catch (err) {
    console.error('Erro ao buscar turnos:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

const TURNO_FIELD_LABELS = { nome: 'nome', inicio: 'início', fim: 'fim', metaOee: 'meta OEE' };

app.post('/api/config/turnos', requireRole(['supervisor', 'administrador']), async (req, res) => {
  try {
    const turnos = req.body;

    // Busca os valores atuais ANTES de sobrescrever, para poder registrar na
    // auditoria exatamente o que mudou (de → para), não só que "algo mudou".
    const previousRes = await db.query('SELECT * FROM turnos_config');
    const previousByKey = {};
    previousRes.rows.forEach((row) => {
      previousByKey[row.turno_key] = {
        nome: row.nome,
        inicio: row.hora_inicio,
        fim: row.hora_fim,
        metaOee: Number(row.meta_oee)
      };
    });

    for (const [key, val] of Object.entries(turnos)) {
      await db.query(
        `INSERT INTO turnos_config (turno_key, nome, hora_inicio, hora_fim, meta_oee)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (turno_key) DO UPDATE
         SET nome = EXCLUDED.nome, hora_inicio = EXCLUDED.hora_inicio, hora_fim = EXCLUDED.hora_fim, meta_oee = EXCLUDED.meta_oee`,
        [key, val.nome, val.inicio, val.fim, val.metaOee]
      );
    }

    const alteracoes = [];
    for (const [key, val] of Object.entries(turnos)) {
      const prev = previousByKey[key];
      for (const field of Object.keys(TURNO_FIELD_LABELS)) {
        const oldVal = prev ? prev[field] : undefined;
        const newVal = val[field];
        if (String(oldVal) !== String(newVal)) {
          alteracoes.push(`${key}.${TURNO_FIELD_LABELS[field]}: ${oldVal ?? '(vazio)'} → ${newVal}`);
        }
      }
    }

    logAudit({
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'atualizou configuração de turnos',
      details: { alteracoes: alteracoes.length > 0 ? alteracoes : ['nenhum valor alterado'] }
    });

    res.json({ success: true, message: 'Turnos salvos com sucesso no PostgreSQL!' });
  } catch (err) {
    console.error('Erro ao salvar turnos:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- ROTAS DE CONFIGURAÇÃO DE SENSORES / VARIÁVEIS ---
// Traz TODAS as variáveis (ativas e desativadas) — o frontend decide como
// exibir cada grupo; "ativo" indica se ela está sendo monitorada agora.
app.get('/api/config/sensores', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sensores_config');
    const configs = {};
    result.rows.forEach(row => {
      configs[row.field_name] = {
        descricao: row.descricao,
        unidade: row.unidade,
        minLimit: Number(row.min_limit),
        maxLimit: Number(row.max_limit),
        cor: row.cor,
        fatorCorrecao: Number(row.fator_correcao),
        tipoAlarme: row.tipo_alarme,
        ativo: row.ativo
      };
    });
    res.json(configs);
  } catch (err) {
    console.error('Erro ao buscar sensores:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

const SENSOR_FIELD_LABELS = {
  descricao: 'descrição',
  unidade: 'unidade',
  minLimit: 'limite mínimo',
  maxLimit: 'limite máximo',
  cor: 'cor',
  fatorCorrecao: 'fator de correção',
  tipoAlarme: 'tipo de alarme'
};

app.post('/api/config/sensores', requireRole(['supervisor', 'administrador']), async (req, res) => {
  try {
    const sensores = req.body;

    // Duas variáveis com a mesma descrição confundem o picker de seleção do
    // dashboard — barra ANTES de gravar qualquer coisa (o índice único no
    // banco é a garantia definitiva, isso aqui só dá uma mensagem legível em
    // vez do erro cru do Postgres estourando pro cliente).
    const descricaoToFields = new Map();
    for (const [fieldName, val] of Object.entries(sensores)) {
      const normalizado = (val.descricao || '').trim().toLowerCase();
      if (!normalizado) continue;
      if (descricaoToFields.has(normalizado)) {
        const outroCampo = descricaoToFields.get(normalizado);
        return res.status(400).json({
          error: `A descrição "${val.descricao}" já está sendo usada por "${outroCampo}". Cada variável precisa de uma descrição única.`
        });
      }
      descricaoToFields.set(normalizado, fieldName);
    }

    // Busca os valores atuais ANTES de sobrescrever, para poder registrar na
    // auditoria exatamente o que mudou (de → para) em cada campo do sensor.
    const previousRes = await db.query('SELECT * FROM sensores_config');
    const previousByField = {};
    previousRes.rows.forEach((row) => {
      previousByField[row.field_name] = {
        descricao: row.descricao,
        unidade: row.unidade,
        minLimit: row.min_limit !== null ? Number(row.min_limit) : null,
        maxLimit: row.max_limit !== null ? Number(row.max_limit) : null,
        cor: row.cor,
        fatorCorrecao: row.fator_correcao !== null ? Number(row.fator_correcao) : null,
        tipoAlarme: row.tipo_alarme
      };
    });

    for (const [key, val] of Object.entries(sensores)) {
      await db.query(
        `INSERT INTO sensores_config (field_name, descricao, unidade, min_limit, max_limit, cor, fator_correcao, tipo_alarme)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (field_name) DO UPDATE
         SET descricao = EXCLUDED.descricao, unidade = EXCLUDED.unidade, min_limit = EXCLUDED.min_limit,
             max_limit = EXCLUDED.max_limit, cor = EXCLUDED.cor, fator_correcao = EXCLUDED.fator_correcao, tipo_alarme = EXCLUDED.tipo_alarme`,
        [key, val.descricao, val.unidade, val.minLimit, val.maxLimit, val.cor, val.fatorCorrecao, val.tipoAlarme]
      );
    }

    const alteracoes = [];
    for (const [key, val] of Object.entries(sensores)) {
      const prev = previousByField[key];
      for (const field of Object.keys(SENSOR_FIELD_LABELS)) {
        const oldVal = prev ? prev[field] : undefined;
        const newVal = val[field];
        if (String(oldVal) !== String(newVal)) {
          alteracoes.push(`${key}.${SENSOR_FIELD_LABELS[field]}: ${oldVal ?? '(vazio)'} → ${newVal}`);
        }
      }
    }

    logAudit({
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'atualizou configuração de sensores',
      details: { alteracoes: alteracoes.length > 0 ? alteracoes : ['nenhum valor alterado'] }
    });

    res.json({ success: true, message: 'Sensores salvos com sucesso no PostgreSQL!' });
  } catch (err) {
    console.error('Erro ao salvar sensores:', err);
    if (err.code === '22003') {
      // "numeric field overflow" do Postgres — mensagem específica em vez do
      // "Erro interno" genérico, já que isso normalmente é só um limite
      // mínimo/máximo grande demais digitado por engano.
      return res.status(400).json({ error: 'Limite mínimo ou máximo grande demais.' });
    }
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Exclui uma variável DEFINITIVAMENTE: remove a linha de sensores_config
// (não é mais soft-delete) e tira a variável de qualquer gráfico salvo no
// layout do dashboard. O histórico de leituras já gravado no InfluxDB
// (tag_events/Variaveis) NÃO é apagado — só a configuração de exibição
// daqui é removida. Ação irreversível: não existe mais "reativar".
app.delete('/api/config/sensores/:fieldName', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const { fieldName } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM sensores_config WHERE field_name = $1 RETURNING field_name',
      [fieldName]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Variável não encontrada.' });
    }

    const removidoDosGraficos = await removeFieldFromSavedLayout(fieldName);

    logAudit({
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'excluiu variável de monitoramento definitivamente',
      details: { fieldName, removidoDosGraficosSalvos: removidoDosGraficos }
    });

    res.json({ success: true, message: `Variável "${fieldName}" excluída definitivamente.` });
  } catch (err) {
    console.error('Erro ao excluir sensor:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Lista as tags que o PLC expõe (via API local do plc-service) para o
// picker de "Adicionar nova variável" — restrito a quem pode alterar
// configuração, já que expõe os nomes internos das tags do controlador.
app.get('/api/plc/tags', requireRole(['supervisor', 'administrador']), async (req, res) => {
  try {
    const atomic_scalar = await fetchHistorianRegisteredTags();
    res.json({ atomic_scalar });
  } catch (err) {
    console.error('Erro ao consultar tags do Historian:', err.message);
    res.status(502).json({ error: 'Não foi possível consultar as tags cadastradas no Historian. Verifique se a API dele (historian-api) está rodando.' });
  }
});

// --- ROTAS DE ALARMES ---
// Ciclo de vida: ATIVO -> NORMALIZADO, com reconhecimento independente disso.
// "trigger" e "resolve" são chamados automaticamente pelo frontend
// (ChartCard) só na borda de transição (quando o valor cruza o limite ou
// volta pra dentro dele) — não a cada leitura — então não é preciso
// deduplicar por tempo, só verificar se já existe um alarme ATIVO para
// aquela variável (defesa contra corrida entre abas abertas ao mesmo tempo).

app.post('/api/alarms/trigger', async (req, res) => {
  const { fieldName, valueRead, limitType, limitValue } = req.body;
  if (!fieldName || valueRead === undefined || !limitType || limitValue === undefined) {
    return res.status(400).json({ error: 'Dados incompletos para registrar o alarme.' });
  }
  try {
    const existing = await db.query(
      `SELECT id FROM alarm_history WHERE field_name = $1 AND status = 'ATIVO' LIMIT 1`,
      [fieldName]
    );
    if (existing.rows.length > 0) {
      return res.json({ message: 'Já havia um alarme ativo para esta variável.', id: existing.rows[0].id });
    }

    const result = await db.query(
      `INSERT INTO alarm_history (field_name, value_read, limit_type, limit_value, status)
       VALUES ($1, $2, $3, $4, 'ATIVO') RETURNING id`,
      [fieldName, valueRead, limitType, limitValue]
    );

    // Eventos de alarme (disparo/normalização/reconhecimento) ficam só na
    // Central de Alarmes — não são replicados para a tela de Auditoria.
    res.json({ message: 'Alarme registrado!', id: result.rows[0].id });
  } catch (err) {
    console.error('Erro ao registrar alarme:', err.message);
    res.status(500).json({ error: 'Erro ao registrar o alarme. Tente novamente.' });
  }
});

app.post('/api/alarms/resolve', async (req, res) => {
  const { fieldName } = req.body;
  if (!fieldName) {
    return res.status(400).json({ error: 'Variável não informada.' });
  }
  try {
    await db.query(
      `UPDATE alarm_history SET status = 'NORMALIZADO', cleared_at = CURRENT_TIMESTAMP
       WHERE field_name = $1 AND status = 'ATIVO' RETURNING id`,
      [fieldName]
    );
    res.json({ message: 'Alarme normalizado.' });
  } catch (err) {
    console.error('Erro ao normalizar alarme:', err.message);
    res.status(500).json({ error: 'Erro ao normalizar o alarme.' });
  }
});

// Reconhecer exige usuário logado (qualquer perfil) — é uma ação
// operacional de chão de fábrica, não uma alteração de configuração, mas
// precisa identificar quem reconheceu e quando.
app.put('/api/alarms/:id/acknowledge', requireRole(['operador', 'supervisor', 'administrador']), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE alarm_history SET acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING field_name, limit_type, value_read`,
      [req.user.username, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alarme não encontrado.' });
    }
    res.json({ message: 'Alarme reconhecido.' });
  } catch (err) {
    console.error('Erro ao reconhecer alarme:', err.message);
    res.status(500).json({ error: 'Erro ao reconhecer o alarme.' });
  }
});

// Normaliza manualmente um alarme que ficou ATIVO mesmo com o valor real já
// dentro da faixa (ex.: gráfico removido do layout, ou uma sessão anterior
// que nunca viu a transição de volta ao normal para reconciliar sozinha).
// Restrito a supervisor/administrador, já que é uma correção manual do
// estado do sistema, não uma ação de rotina de chão de fábrica.
app.put('/api/alarms/:id/clear', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE alarm_history SET status = 'NORMALIZADO', cleared_at = CURRENT_TIMESTAMP, cleared_by = $1
       WHERE id = $2 AND status = 'ATIVO' RETURNING field_name`,
      [req.user.username, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alarme não encontrado ou já normalizado.' });
    }
    res.json({ message: 'Alarme normalizado manualmente.' });
  } catch (err) {
    console.error('Erro ao normalizar alarme manualmente:', err.message);
    res.status(500).json({ error: 'Erro ao normalizar o alarme.' });
  }
});

// Consulta o histórico/estado dos alarmes — aberta a qualquer usuário
// logado (visibilidade operacional, igual ao dashboard principal). Suporta
// filtro por variável, status (aceita o status bruto ou os estados
// combinados ATIVO_NAO_RECONHECIDO / ATIVO_RECONHECIDO / NORMALIZADO),
// período e texto livre; ?activeOnly=true é o atalho usado pelo dashboard
// principal para a barra de alarmes ativos e pelo contador do sininho.
app.get('/api/alarms', async (req, res) => {
  const { fieldName, status, startDate, endDate, search, limit, activeOnly } = req.query;
  const conditions = [];
  const values = [];
  let idx = 1;

  if (fieldName) {
    conditions.push(`field_name ILIKE $${idx++}`);
    values.push(`%${fieldName}%`);
  }

  if (activeOnly === 'true') {
    conditions.push(`status = 'ATIVO'`);
  } else if (status === 'ATIVO_NAO_RECONHECIDO') {
    conditions.push(`status = 'ATIVO' AND acknowledged = FALSE`);
  } else if (status === 'ATIVO_RECONHECIDO') {
    conditions.push(`status = 'ATIVO' AND acknowledged = TRUE`);
  } else if (status === 'NORMALIZADO') {
    conditions.push(`status = 'NORMALIZADO'`);
  }

  if (startDate) {
    const startDateObj = new Date(startDate);
    if (Number.isNaN(startDateObj.getTime())) {
      return res.status(400).json({ error: 'Data inicial inválida.' });
    }
    conditions.push(`created_at >= $${idx++}`);
    values.push(startDateObj.toISOString());
  }

  if (endDate) {
    const endDateObj = new Date(endDate);
    if (Number.isNaN(endDateObj.getTime())) {
      return res.status(400).json({ error: 'Data final inválida.' });
    }
    conditions.push(`created_at <= $${idx++}`);
    values.push(endDateObj.toISOString());
  }

  if (search) {
    conditions.push(`(field_name ILIKE $${idx} OR limit_type ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rowLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

  try {
    const result = await db.query(
      `SELECT id, field_name, value_read, limit_type, limit_value, status,
              acknowledged, acknowledged_by, cleared_by,
              TO_CHAR(acknowledged_at, 'DD/MM/YYYY HH24:MI:SS') as acknowledged_at_formatted,
              TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') as formatted_date,
              TO_CHAR(cleared_at, 'DD/MM/YYYY HH24:MI:SS') as cleared_at_formatted
       FROM alarm_history
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${rowLimit}`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar histórico de alarmes:', err.message);
    res.status(500).json({ error: 'Erro ao buscar histórico de alarmes.' });
  }
});

// --- ROTA DE AUDITORIA ---
// Consulta o histórico de alterações do sistema — apenas administradores.
// Suporta filtro por usuário (busca parcial), por período (data/hora inicial
// e final) e por texto livre (procura na ação e nos detalhes). Sempre usa
// consultas parametrizadas ($1, $2...) para os valores vindos do usuário —
// nunca concatenados direto na string SQL.
app.get('/api/audit-log', requireRole(['administrador']), async (req, res) => {
  const { username, startDate, endDate, search, limit } = req.query;
  const conditions = [];
  const values = [];
  let idx = 1;

  if (username) {
    conditions.push(`username ILIKE $${idx++}`);
    values.push(`%${username}%`);
  }

  if (startDate) {
    const startDateObj = new Date(startDate);
    if (Number.isNaN(startDateObj.getTime())) {
      return res.status(400).json({ error: 'Data inicial inválida.' });
    }
    conditions.push(`created_at >= $${idx++}`);
    values.push(startDateObj.toISOString());
  }

  if (endDate) {
    const endDateObj = new Date(endDate);
    if (Number.isNaN(endDateObj.getTime())) {
      return res.status(400).json({ error: 'Data final inválida.' });
    }
    conditions.push(`created_at <= $${idx++}`);
    values.push(endDateObj.toISOString());
  }

  if (search) {
    conditions.push(`(action ILIKE $${idx} OR details::text ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // Limite sempre um número seguro entre 1 e 500 (Math.min/Math.max garantem
  // isso mesmo com entrada inválida), então é seguro interpolar direto na
  // query — não vem de string livre do usuário.
  const rowLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

  try {
    const result = await db.query(
      `SELECT id, user_id, username, role, action, details,
              TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') as formatted_date
       FROM audit_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${rowLimit}`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao consultar auditoria:', err.message);
    res.status(500).json({ error: 'Erro ao consultar histórico de auditoria.' });
  }
});

// --- CONFIGURAÇÃO DO OEE (mapeamento de variáveis) ---
// Em vez de nomes de tag fixos no código, cada papel do cálculo de OEE
// aponta pra uma das variáveis já cadastradas (sensores_config/InfluxDB) —
// configurável pela tela de Configuração, sem precisar mexer em código
// quando o CLP ganhar ou trocar uma tag.
app.get('/api/config/oee', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM oee_config WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({
        fieldTempoRodando: null, fieldContagemTotal: null, fieldContagemRefugo: null,
        fieldMaquinaRodando: null, fieldVelocidadeNominal: null, fieldVelocidadeReal: null,
        velocidadeNominalPpm: 50, tempoPlanejadoSeg: 28800
      });
    }
    const row = result.rows[0];
    res.json({
      fieldTempoRodando: row.field_tempo_rodando,
      fieldContagemTotal: row.field_contagem_total,
      fieldContagemRefugo: row.field_contagem_refugo,
      fieldMaquinaRodando: row.field_maquina_rodando,
      fieldVelocidadeNominal: row.field_velocidade_nominal,
      fieldVelocidadeReal: row.field_velocidade_real,
      velocidadeNominalPpm: Number(row.velocidade_nominal_ppm),
      tempoPlanejadoSeg: Number(row.tempo_planejado_seg)
    });
  } catch (err) {
    console.error('Erro ao buscar config do OEE:', err);
    res.status(500).json({ error: 'Erro ao buscar configuração do OEE' });
  }
});

app.post('/api/config/oee', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const {
    fieldTempoRodando, fieldContagemTotal, fieldContagemRefugo,
    fieldMaquinaRodando, fieldVelocidadeNominal, fieldVelocidadeReal,
    velocidadeNominalPpm, tempoPlanejadoSeg
  } = req.body;
  try {
    await db.query(
      `INSERT INTO oee_config (id, field_tempo_rodando, field_contagem_total, field_contagem_refugo,
                                field_maquina_rodando, field_velocidade_nominal, field_velocidade_real, velocidade_nominal_ppm, tempo_planejado_seg, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         field_tempo_rodando = EXCLUDED.field_tempo_rodando,
         field_contagem_total = EXCLUDED.field_contagem_total,
         field_contagem_refugo = EXCLUDED.field_contagem_refugo,
         field_maquina_rodando = EXCLUDED.field_maquina_rodando,
         field_velocidade_nominal = EXCLUDED.field_velocidade_nominal,
         field_velocidade_real = EXCLUDED.field_velocidade_real,
         velocidade_nominal_ppm = EXCLUDED.velocidade_nominal_ppm,
         tempo_planejado_seg = EXCLUDED.tempo_planejado_seg,
         updated_at = CURRENT_TIMESTAMP`,
      [
        fieldTempoRodando || null, fieldContagemTotal || null, fieldContagemRefugo || null,
        fieldMaquinaRodando || null, fieldVelocidadeNominal || null, fieldVelocidadeReal || null,
        Number(velocidadeNominalPpm) || 50, Number(tempoPlanejadoSeg) || 28800
      ]
    );

    logAudit({
      userId: req.user.id, username: req.user.username, role: req.user.role,
      action: 'salvou configuração do OEE',
      details: { fieldTempoRodando, fieldContagemTotal, fieldContagemRefugo, fieldMaquinaRodando, fieldVelocidadeNominal, fieldVelocidadeReal, velocidadeNominalPpm, tempoPlanejadoSeg }
    });

    res.json({ message: 'Configuração do OEE salva!' });
  } catch (err) {
    console.error('Erro ao salvar config do OEE:', err);
    res.status(500).json({ error: 'Erro ao salvar configuração do OEE' });
  }
});

// --- ROTA DE MÉTRICAS OEE ---
// Busca a leitura mais recente de uma tag no InfluxDB (tag_events, formato
// longo). Usada tanto pra tags cumulativas (contadores) quanto pro status
// booleano da máquina.
async function influxLatestValue(tagName) {
  if (!tagName) return null;
  const reader = await influxDB.query(
    `SELECT value_num FROM "tag_events" WHERE tag_name = '${tagName}' ORDER BY time DESC LIMIT 1`
  );
  for await (const row of reader) return row.value_num;
  return null;
}

// Igual a influxLatestValue, mas pra tags BOOL — essas gravam em value_bool,
// não em value_num (que fica sempre vazio pra elas). Usada pra "Máquina
// Rodando" e pelo detector automático de paradas.
async function influxLatestBoolValue(tagName) {
  if (!tagName) return null;
  const reader = await influxDB.query(
    `SELECT value_bool FROM "tag_events" WHERE tag_name = '${tagName}' ORDER BY time DESC LIMIT 1`
  );
  for await (const row of reader) return row.value_bool;
  return null;
}

// Busca o valor de uma tag na hora, ou um pouco antes, de um timestamp
// específico — usada pra pegar o valor de um contador cumulativo no
// início/fim de um turno (não só "agora"), inclusive turnos já terminados
// hoje (cujos números precisam ficar parados no que eram no fim do turno,
// não continuar mudando com o que está acontecendo agora).
async function influxValueAtOrBefore(tagName, isoTimestamp) {
  if (!tagName) return null;
  const reader = await influxDB.query(
    `SELECT value_num FROM "tag_events" WHERE tag_name = '${tagName}' AND time <= '${isoTimestamp}' ORDER BY time DESC LIMIT 1`
  );
  for await (const row of reader) return row.value_num;
  return null;
}

// Primeira leitura disponível A PARTIR de um timestamp — reserva pra quando
// não existe NENHUMA leitura antes do início da janela (ex: a tag só
// começou a ser lida pelo Historian depois que o turno já tinha começado).
// Sem isso, a primeira leitura vira "delta = valor cheio", contando como se
// tudo que o CLP já tinha acumulado antes de existirmos tivesse acontecido
// dentro da janela.
async function influxFirstValueFrom(tagName, isoTimestamp) {
  if (!tagName) return null;
  const reader = await influxDB.query(
    `SELECT value_num FROM "tag_events" WHERE tag_name = '${tagName}' AND time >= '${isoTimestamp}' ORDER BY time ASC LIMIT 1`
  );
  for await (const row of reader) return row.value_num;
  return null;
}

async function influxBaseline(tagName, isoTimestamp) {
  const before = await influxValueAtOrBefore(tagName, isoTimestamp);
  if (before !== null) return before;
  return influxFirstValueFrom(tagName, isoTimestamp);
}

const hhmmToMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Pra um turno configurado (hora_inicio/hora_fim), acha a ocorrência mais
// recente que já começou — pode ser a de HOJE ou a de ONTEM (cobre turnos
// que atravessam a meia-noite, e turnos que ainda não começaram hoje, que
// usam a última ocorrência real, a de ontem, em vez de aparecer vazio).
// Janela de UM turno num dia específico (diaOffset: 0 = hoje, -1 = ontem,
// -2 = anteontem...) — não olha se já começou ou não, só calcula onde cairia.
function ocorrenciaNoDia(row, now, diaOffset) {
  const inicioMin = hhmmToMinutes(row.hora_inicio);
  const fimMin = hhmmToMinutes(row.hora_fim);
  const duracaoMin = fimMin > inicioMin ? (fimMin - inicioMin) : (1440 - inicioMin + fimMin);
  const inicioDia = new Date(now);
  inicioDia.setHours(0, 0, 0, 0);
  inicioDia.setDate(inicioDia.getDate() + diaOffset);
  const start = new Date(inicioDia.getTime() + inicioMin * 60000);
  const end = new Date(start.getTime() + duracaoMin * 60000);
  return { start, end, plannedSeg: duracaoMin * 60 };
}

function calcularOcorrencia(row, now) {
  const candidatos = [0, -1]
    .map((diaOffset) => ocorrenciaNoDia(row, now, diaOffset))
    .filter((c) => c.start.getTime() <= now.getTime());

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => b.start.getTime() - a.start.getTime());
  const { start, end, plannedSeg } = candidatos[0];
  const isAtual = now.getTime() < end.getTime();

  return { start, end: isAtual ? now : end, plannedSeg, isAtual };
}

// Igual a calcularOcorrencia, mas sem cortar o fim no relógio de agora —
// usada pro gráfico de tendência DENTRO do turno (ver /api/oee/tendencia-turno),
// que precisa saber o horário final PROGRAMADO pra desenhar o eixo X inteiro
// mesmo que o turno ainda não tenha chegado lá.
function ocorrenciaCompleta(row, now) {
  const candidatos = [0, -1]
    .map((diaOffset) => ocorrenciaNoDia(row, now, diaOffset))
    .filter((c) => c.start.getTime() <= now.getTime());
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => b.start.getTime() - a.start.getTime());
  const { start, end, plannedSeg } = candidatos[0];
  const isAtual = now.getTime() < end.getTime();
  return { start, endProgramado: end, plannedSeg, isAtual };
}

// As últimas N ocorrências de um turno (mais recente primeiro) — usada pro
// histórico real de OEE (ver GET /api/oee/historico), andando um dia de
// cada vez pra trás até juntar a quantidade pedida.
function ultimasOcorrencias(row, now, quantidade) {
  const resultados = [];
  let diaOffset = 0;
  let tentativas = 0;
  while (resultados.length < quantidade && tentativas < quantidade + 3) {
    tentativas += 1;
    const occ = ocorrenciaNoDia(row, now, diaOffset);
    if (occ.start.getTime() <= now.getTime()) {
      const isAtual = now.getTime() < occ.end.getTime();
      resultados.push({ ...occ, end: isAtual ? now : occ.end, isAtual });
    }
    diaOffset -= 1;
  }
  return resultados;
}

// Calcula runTime/contagem/refugo/qualidade pra UM turno específico, já
// considerando o "zerado_em" (ver POST /api/oee/reset): o início efetivo da
// janela nunca é anterior a esse ponto de partida. Se o turno inteiro já
// tinha terminado antes do reset, devolve tudo zerado (esse turno "ainda não
// aconteceu" desde que zeramos).
async function calcularMetricasTurno(cfg, ocorrencia, zeradoEm) {
  const zeroBase = {
    isAtual: ocorrencia?.isAtual || false, plannedSeg: ocorrencia?.plannedSeg || 0,
    runTimeSec: 0, totalCount: 0, refugoCount: 0, goodCount: 0,
    maquinaRodando: null, velocidadeInstantaneaPpm: null
  };
  if (!ocorrencia) return zeroBase;

  let effectiveStart = ocorrencia.start;
  if (zeradoEm && zeradoEm.getTime() > effectiveStart.getTime()) effectiveStart = zeradoEm;
  if (effectiveStart.getTime() >= ocorrencia.end.getTime()) return zeroBase;

  const startISO = effectiveStart.toISOString();
  const endISO = ocorrencia.end.toISOString();
  const valorNoFim = (tag) => (ocorrencia.isAtual ? influxLatestValue(tag) : influxValueAtOrBefore(tag, endISO));

  const [
    tempoRodandoFim, tempoRodandoInicio,
    totalFim, totalInicio,
    refugoFim, refugoInicio,
    maquinaRodando
  ] = await Promise.all([
    valorNoFim(cfg.field_tempo_rodando),
    influxBaseline(cfg.field_tempo_rodando, startISO),
    valorNoFim(cfg.field_contagem_total),
    influxBaseline(cfg.field_contagem_total, startISO),
    valorNoFim(cfg.field_contagem_refugo),
    influxBaseline(cfg.field_contagem_refugo, startISO),
    ocorrencia.isAtual ? influxLatestBoolValue(cfg.field_maquina_rodando) : Promise.resolve(null)
  ]);

  const delta = (fim, inicio) => Math.max(0, Number(fim || 0) - Number(inicio ?? 0));

  const runTimeSec = delta(tempoRodandoFim, tempoRodandoInicio);
  const totalCount = delta(totalFim, totalInicio);
  const refugoCount = delta(refugoFim, refugoInicio);
  const goodCount = Math.max(0, totalCount - refugoCount);

  // Velocidade instantânea só faz sentido pro turno que está rodando agora
  // — os outros são fotografias de um período que já passou. Preferência:
  // se o CLP já calcula e fornece a velocidade real (field_velocidade_real),
  // usa ela direto — mais precisa que estimar por delta da Contagem Total
  // (que só serve de reserva enquanto essa variável não estiver mapeada).
  let velocidadeInstantaneaPpm = null;
  if (ocorrencia.isAtual) {
    if (cfg.field_velocidade_real) {
      velocidadeInstantaneaPpm = await influxLatestValue(cfg.field_velocidade_real);
    }
    if (velocidadeInstantaneaPpm === null) {
      const umMinutoAtrasISO = new Date(Date.now() - 60000).toISOString();
      const totalUmMinAtras = await influxValueAtOrBefore(cfg.field_contagem_total, umMinutoAtrasISO);
      velocidadeInstantaneaPpm = totalUmMinAtras === null ? null : delta(totalFim, totalUmMinAtras);
    }
  }

  // Tempo Planejado (denominador da Disponibilidade) desconta as paradas
  // PROGRAMADAS (limpeza, setup, manutenção preventiva...) que caíram dentro
  // da janela do turno inteiro — igual à definição padrão de OEE ("Planned
  // Production Time = Shift Length − Breaks", ver oee.com). Paradas NÃO
  // programadas não entram aqui: elas já reduzem o Tempo Rodando sozinhas.
  const paradasSeg = await paradasProgramadasSeg(ocorrencia.start, ocorrencia.end);
  const plannedSegAjustado = Math.max(0, ocorrencia.plannedSeg - paradasSeg);

  return {
    isAtual: ocorrencia.isAtual, plannedSeg: plannedSegAjustado,
    runTimeSec, totalCount, refugoCount, goodCount,
    maquinaRodando: maquinaRodando === null ? null : !!maquinaRodando,
    velocidadeInstantaneaPpm
  };
}

// Soma a duração (em segundos) das paradas PROGRAMADAS que se sobrepõem à
// janela [inicio, fim] — parcialmente, se a parada começou antes ou terminou
// depois da janela, conta só a parte que cai dentro dela.
async function paradasProgramadasSeg(inicio, fim) {
  const result = await db.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(p.finalizado_em, $2::timestamptz) - GREATEST(p.iniciado_em, $1::timestamptz)))), 0) AS total_seg
     FROM paradas p
     JOIN motivos_parada m ON m.id = p.motivo_id
     WHERE m.tipo = 'programada'
       AND p.finalizado_em IS NOT NULL
       AND p.iniciado_em < $2::timestamptz
       AND p.finalizado_em > $1::timestamptz`,
    [inicio.toISOString(), fim.toISOString()]
  );
  return Number(result.rows[0]?.total_seg) || 0;
}

// Devolve as métricas dos 3 turnos configurados (turnos_config — tela de
// Configurar) de uma vez, cada um com sua própria ocorrência mais recente
// (hoje ou ontem) — não é mais só "o turno de agora".
app.get('/api/oee/metrics', async (req, res) => {
  try {
    const cfgRes = await db.query('SELECT * FROM oee_config WHERE id = 1');
    const cfg = cfgRes.rows[0] || {};
    // Velocidade nominal preferencialmente vem de uma variável do CLP
    // (ajustável na IHM, ex: setpoint de velocidade da linha) — o número
    // configurado na tela só é usado como reserva se essa tag ainda não
    // estiver mapeada, ou sem nenhuma leitura ainda.
    const velocidadeNominalDoPlc = await influxLatestValue(cfg.field_velocidade_nominal);
    const velocidadeNominalPpm = velocidadeNominalDoPlc !== null
      ? Number(velocidadeNominalDoPlc)
      : (Number(cfg.velocidade_nominal_ppm) || 50);
    const configured = !!(cfg.field_tempo_rodando && cfg.field_contagem_total);

    const turnosRes = await db.query('SELECT * FROM turnos_config ORDER BY turno_key');
    const now = new Date();

    const turnos = {};
    for (const row of turnosRes.rows) {
      // Ponto de partida do "Zerar" é POR TURNO agora (turnos_config.zerado_em)
      // — cada turno tem o seu, zerar um não mexe nos outros.
      const zeradoEm = row.zerado_em ? new Date(row.zerado_em) : null;
      const ocorrencia = calcularOcorrencia(row, now);
      const metrics = configured
        ? await calcularMetricasTurno(cfg, ocorrencia, zeradoEm)
        : { isAtual: ocorrencia?.isAtual || false, plannedSeg: ocorrencia?.plannedSeg || 0,
            runTimeSec: 0, totalCount: 0, refugoCount: 0, goodCount: 0,
            maquinaRodando: null, velocidadeInstantaneaPpm: null };

      // OEE Acumulado "leitura direta": Peças Boas ÷ (minutos decorridos ×
      // Velocidade Padrão) — indicador adicional pedido pelo usuário, mais
      // fácil de explicar pro operador que o A×P×Q do anel (que continua
      // sendo o cálculo oficial, sem mudança). Diferença de propósito: os
      // minutos decorridos aqui são CRUS (não descontam parada programada)
      // — mostra o ritmo real contra o relógio corrido do turno, sem
      // "perdão" por parada avisada.
      let elapsedMin = 0, expectedCount = 0, oeeSimplificado = 0;
      if (configured && ocorrencia) {
        let effectiveStart = ocorrencia.start;
        if (zeradoEm && zeradoEm.getTime() > effectiveStart.getTime()) effectiveStart = zeradoEm;
        const refTime = ocorrencia.isAtual ? now : ocorrencia.end;
        elapsedMin = Math.max(0, (refTime.getTime() - effectiveStart.getTime()) / 60000);
        expectedCount = elapsedMin * velocidadeNominalPpm;
        oeeSimplificado = expectedCount > 0 ? Math.min(100, (metrics.goodCount / expectedCount) * 100) : 0;
      }

      turnos[row.turno_key] = {
        nome: row.nome, metaOee: Number(row.meta_oee), ...metrics,
        elapsedMin: Number(elapsedMin.toFixed(1)),
        expectedCount: Math.round(expectedCount),
        oeeSimplificado: Number(oeeSimplificado.toFixed(1)),
        zeradoEm: row.zerado_em || null
      };
    }

    const statusMaquina = await statusAtualMaquina(cfg);

    res.json({ configured, velocidadeNominalPpm, turnos, statusMaquina });
  } catch (err) {
    console.error('[Erro OEE Metrics]:', err.message);
    res.json({ configured: false, velocidadeNominalPpm: 50, turnos: {}, zeradoEm: null, statusMaquina: { rodando: null, desde: null } });
  }
});

// Estado atual da máquina (ligada/parada) e desde quando — usado pro card de
// status na tela de OEE. "Desde quando" vem do próprio histórico de paradas:
// se está parada agora, desde o início da parada ainda aberta; se está
// rodando, desde o fim da última parada fechada (ou null se nunca parou
// desde que o detector começou a observar).
async function statusAtualMaquina(cfg) {
  if (!cfg.field_maquina_rodando) return { rodando: null, desde: null };
  const rodando = await influxLatestBoolValue(cfg.field_maquina_rodando);
  if (rodando === null) return { rodando: null, desde: null };

  if (rodando) {
    const r = await db.query('SELECT finalizado_em FROM paradas WHERE finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1');
    return { rodando: true, desde: r.rows[0]?.finalizado_em || null };
  }
  const r = await db.query('SELECT iniciado_em FROM paradas WHERE finalizado_em IS NULL ORDER BY iniciado_em DESC LIMIT 1');
  return { rodando: false, desde: r.rows[0]?.iniciado_em || null };
}

// "Zera" o cálculo do OEE do turno ATUAL a partir de agora — restrito a
// administrador (ação sensível: mexe direto no painel que a gestão usa pra
// cobrar meta). Não mexe nos contadores reais do CLP (esses continuam só
// crescendo, de propósito) nem nos outros dois turnos, cada um com seu
// próprio ponto de partida (turnos_config.zerado_em) — e não afeta em nada
// o gráfico de tendência, que nunca olha pra essa coluna (ver
// GET /api/oee/tendencia-turno), justamente pra nunca "apagar" histórico.
app.post('/api/oee/reset', requireRole(['administrador']), async (req, res) => {
  try {
    const turnosRes = await db.query('SELECT * FROM turnos_config ORDER BY turno_key');
    const now = new Date();
    const turnoAtual = turnosRes.rows.find((row) => calcularOcorrencia(row, now)?.isAtual);

    if (!turnoAtual) {
      return res.status(400).json({ error: 'Nenhum turno está ativo agora — confira os horários em Configurar → Turnos.' });
    }

    await db.query(
      'UPDATE turnos_config SET zerado_em = CURRENT_TIMESTAMP WHERE turno_key = $1',
      [turnoAtual.turno_key]
    );
    logAudit({
      userId: req.user.id, username: req.user.username, role: req.user.role,
      action: 'zerou os contadores do OEE do turno atual',
      details: { turnoKey: turnoAtual.turno_key, turnoNome: turnoAtual.nome }
    });
    res.json({ message: `Contadores do ${turnoAtual.nome} zerados a partir de agora!`, turnoKey: turnoAtual.turno_key });
  } catch (err) {
    console.error('Erro ao zerar OEE:', err);
    res.status(500).json({ error: 'Erro ao zerar contadores do OEE' });
  }
});

// --- DETECTOR AUTOMÁTICO DE PARADAS ---
// Observa o histórico da tag "Máquina Rodando" (mapeada em Configurar → OEE)
// e cria/fecha eventos em `paradas` sozinho, sem depender de ninguém com a
// tela aberta: toda transição rodando→parado abre uma parada; toda
// parado→rodando fecha a mais recente ainda aberta. Roda em intervalo fixo,
// independente de requisição HTTP nenhuma.
async function detectarParadas() {
  try {
    const cfgRes = await db.query('SELECT field_maquina_rodando FROM oee_config WHERE id = 1');
    const fieldMaquinaRodando = cfgRes.rows[0]?.field_maquina_rodando;
    if (!fieldMaquinaRodando) return; // nada mapeado ainda, nada a observar

    const stateRes = await db.query('SELECT * FROM parada_detector_state WHERE id = 1');
    let ultimoProcessado = stateRes.rows[0]?.ultimo_processado_em || null;
    let ultimoValor = stateRes.rows[0]?.ultimo_valor_conhecido;
    if (ultimoValor === undefined) ultimoValor = null;

    // Primeira vez rodando: não varre o histórico todo, só as últimas 24h —
    // evita recriar dias de paradas antigas na estreia do detector.
    const desdeISO = ultimoProcessado
      ? new Date(ultimoProcessado).toISOString()
      : new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const reader = await influxDB.query(
      `SELECT time, value_bool FROM "tag_events" WHERE tag_name = '${fieldMaquinaRodando}' AND time > '${desdeISO}' ORDER BY time ASC`
    );
    const leituras = [];
    for await (const row of reader) leituras.push({ time: new Date(Number(row.time)), valor: !!row.value_bool });
    if (leituras.length === 0) return;

    for (const leitura of leituras) {
      if (ultimoValor === null) {
        // primeira leitura conhecida de todas — só define a base, não conta
        // como transição (não sabemos o que veio antes dela).
        ultimoValor = leitura.valor;
        continue;
      }
      if (leitura.valor === ultimoValor) continue; // sem mudança de estado

      if (ultimoValor === true && leitura.valor === false) {
        await db.query('INSERT INTO paradas (iniciado_em) VALUES ($1)', [leitura.time]);
      } else if (ultimoValor === false && leitura.valor === true) {
        await db.query(
          `UPDATE paradas SET finalizado_em = $1
           WHERE id = (SELECT id FROM paradas WHERE finalizado_em IS NULL ORDER BY iniciado_em DESC LIMIT 1)`,
          [leitura.time]
        );
      }
      ultimoValor = leitura.valor;
    }

    const ultimaLeitura = leituras[leituras.length - 1];
    await db.query(
      `INSERT INTO parada_detector_state (id, ultimo_processado_em, ultimo_valor_conhecido)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET ultimo_processado_em = EXCLUDED.ultimo_processado_em, ultimo_valor_conhecido = EXCLUDED.ultimo_valor_conhecido`,
      [ultimaLeitura.time, ultimoValor]
    );
  } catch (err) {
    console.error('[Erro detector de paradas]:', err.message);
  }
}
setInterval(detectarParadas, 15000);
detectarParadas();

// --- ROTAS DE MOTIVOS DE PARADA (catálogo) ---
app.get('/api/paradas/motivos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM motivos_parada ORDER BY tipo, nome');
    res.json(result.rows.map((r) => ({ id: r.id, nome: r.nome, tipo: r.tipo, ativo: r.ativo })));
  } catch (err) {
    console.error('Erro ao listar motivos de parada:', err);
    res.status(500).json({ error: 'Erro ao listar motivos de parada' });
  }
});

app.post('/api/paradas/motivos', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const { nome, tipo } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: 'Informe o nome do motivo.' });
  if (!['programada', 'nao_programada'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  try {
    const result = await db.query(
      'INSERT INTO motivos_parada (nome, tipo) VALUES ($1, $2) RETURNING id, nome, tipo, ativo',
      [nome.trim(), tipo]
    );
    logAudit({ userId: req.user.id, username: req.user.username, role: req.user.role, action: 'criou motivo de parada', details: { nome, tipo } });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um motivo com esse nome.' });
    console.error('Erro ao criar motivo de parada:', err);
    res.status(500).json({ error: 'Erro ao criar motivo de parada' });
  }
});

app.put('/api/paradas/motivos/:id', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const { nome, tipo, ativo } = req.body;
  try {
    const result = await db.query(
      `UPDATE motivos_parada SET
         nome = COALESCE($1, nome),
         tipo = COALESCE($2, tipo),
         ativo = COALESCE($3, ativo)
       WHERE id = $4 RETURNING id, nome, tipo, ativo`,
      [nome?.trim() || null, tipo || null, typeof ativo === 'boolean' ? ativo : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Motivo não encontrado.' });
    logAudit({ userId: req.user.id, username: req.user.username, role: req.user.role, action: 'editou motivo de parada', details: { id: req.params.id, nome, tipo, ativo } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao editar motivo de parada:', err);
    res.status(500).json({ error: 'Erro ao editar motivo de parada' });
  }
});

// --- ROTAS DE PARADAS (eventos) ---
// status: 'pendentes' (finalizadas mas sem motivo — precisam de ação do
// operador), 'abertas' (a máquina ainda está parada agora), ou omitido
// (histórico geral, mais recentes primeiro).
// startDate/endDate (opcionais, ISO) filtram por iniciado_em — usados tanto
// pela tela (que por padrão só pede o dia de hoje, pra não empilhar
// histórico velho na tela) quanto pelo botão "Gerar Relatório" (período
// escolhido pelo usuário). Sem esses parâmetros, cai no comportamento antigo
// (últimas N paradas, sem filtro de data) — usado por status=pendentes e
// status=abertas, que são filas operacionais, não relatório.
app.get('/api/paradas', async (req, res) => {
  const { status, limit, startDate, endDate } = req.query;
  // Com período explícito (relatório), o limite sobe bastante — é uma
  // consulta pontual, não a lista "ao vivo" da tela.
  const lim = Math.min(startDate && endDate ? 5000 : 200, Number(limit) || 50);
  try {
    const conditions = [];
    const params = [];
    if (status === 'pendentes') conditions.push('p.finalizado_em IS NOT NULL AND p.motivo_id IS NULL');
    else if (status === 'abertas') conditions.push('p.finalizado_em IS NULL');

    if (startDate) {
      const d = new Date(startDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Data inicial inválida.' });
      params.push(d.toISOString());
      conditions.push(`p.iniciado_em >= $${params.length}`);
    }
    if (endDate) {
      const d = new Date(endDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Data final inválida.' });
      params.push(d.toISOString());
      conditions.push(`p.iniciado_em <= $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(lim);

    const result = await db.query(
      `SELECT p.id, p.iniciado_em, p.finalizado_em, p.motivo_id, m.nome AS motivo_nome, m.tipo AS motivo_tipo,
              p.justificativa, p.classificado_por_username, p.classificado_em
       FROM paradas p
       LEFT JOIN motivos_parada m ON m.id = p.motivo_id
       ${where}
       ORDER BY p.iniciado_em DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar paradas:', err);
    res.status(500).json({ error: 'Erro ao listar paradas' });
  }
});

// Classificar (ou reclassificar) uma parada: motivo + justificativa. Aberta
// pra qualquer papel operacional — é o operador que normalmente faz isso.
app.put('/api/paradas/:id/classificar', requireRole(['operador', 'supervisor', 'administrador']), async (req, res) => {
  const { motivoId, justificativa } = req.body;
  if (!motivoId) return res.status(400).json({ error: 'Selecione um motivo.' });
  try {
    const result = await db.query(
      `UPDATE paradas SET
         motivo_id = $1, justificativa = $2,
         classificado_por_id = $3, classificado_por_username = $4, classificado_em = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING id`,
      [motivoId, justificativa || null, req.user.id, req.user.username, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Parada não encontrada.' });
    logAudit({ userId: req.user.id, username: req.user.username, role: req.user.role, action: 'classificou parada', details: { id: req.params.id, motivoId, justificativa } });
    res.json({ message: 'Parada classificada!' });
  } catch (err) {
    console.error('Erro ao classificar parada:', err);
    res.status(500).json({ error: 'Erro ao classificar parada' });
  }
});

// Pareto de paradas: tempo total parado por motivo, num período — ranking
// de "onde focar melhoria" — mais MTBF/MTTR, calculados só sobre as paradas
// NÃO programadas (falhas de verdade, não limpeza/setup planejados).
// startDate/endDate (opcionais, ISO) definem o período explicitamente — usado
// pelo botão "Gerar Relatório" e, com o dia de hoje, pela tela por padrão.
// Sem eles, cai no comportamento antigo de janela rolante de N dias (`dias`).
app.get('/api/paradas/pareto', async (req, res) => {
  const { startDate, endDate } = req.query;
  const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));

  let desdeISO, ateISO;
  if (startDate && endDate) {
    const inicio = new Date(startDate);
    const fim = new Date(endDate);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      return res.status(400).json({ error: 'Data inicial ou final inválida.' });
    }
    desdeISO = inicio.toISOString();
    ateISO = fim.toISOString();
  } else {
    desdeISO = new Date(Date.now() - dias * 86400000).toISOString();
    ateISO = new Date().toISOString();
  }

  try {
    const porMotivo = await db.query(
      `SELECT m.id AS motivo_id, m.nome, m.tipo,
              COUNT(*) AS quantidade,
              COALESCE(SUM(EXTRACT(EPOCH FROM (p.finalizado_em - p.iniciado_em))), 0) AS total_seg
       FROM paradas p
       JOIN motivos_parada m ON m.id = p.motivo_id
       WHERE p.finalizado_em IS NOT NULL
         AND p.iniciado_em >= $1 AND p.iniciado_em <= $2
       GROUP BY m.id, m.nome, m.tipo
       ORDER BY total_seg DESC`,
      [desdeISO, ateISO]
    );

    // MTTR: duração média das paradas não programadas (tempo médio de reparo).
    // MTBF: tempo médio decorrido entre o INÍCIO de uma falha não programada
    // e o início da seguinte (aproximação padrão quando não se mede tempo de
    // produção real minuto a minuto fora daqui).
    const naoProgramadas = await db.query(
      `SELECT p.iniciado_em, p.finalizado_em
       FROM paradas p
       JOIN motivos_parada m ON m.id = p.motivo_id
       WHERE m.tipo = 'nao_programada'
         AND p.finalizado_em IS NOT NULL
         AND p.iniciado_em >= $1 AND p.iniciado_em <= $2
       ORDER BY p.iniciado_em ASC`,
      [desdeISO, ateISO]
    );

    const falhas = naoProgramadas.rows;
    let mttrSeg = null, mtbfSeg = null;
    if (falhas.length > 0) {
      const totalDuracaoSeg = falhas.reduce((acc, f) => acc + (new Date(f.finalizado_em) - new Date(f.iniciado_em)) / 1000, 0);
      mttrSeg = totalDuracaoSeg / falhas.length;
    }
    if (falhas.length > 1) {
      let totalEntreFalhasSeg = 0;
      for (let i = 1; i < falhas.length; i++) {
        totalEntreFalhasSeg += (new Date(falhas[i].iniciado_em) - new Date(falhas[i - 1].iniciado_em)) / 1000;
      }
      mtbfSeg = totalEntreFalhasSeg / (falhas.length - 1);
    }

    res.json({
      dias,
      porMotivo: porMotivo.rows.map((r) => ({
        motivoId: r.motivo_id, nome: r.nome, tipo: r.tipo,
        quantidade: Number(r.quantidade), totalSeg: Number(r.total_seg)
      })),
      totalFalhas: falhas.length,
      mttrSeg, mtbfSeg
    });
  } catch (err) {
    console.error('Erro ao calcular pareto de paradas:', err);
    res.status(500).json({ error: 'Erro ao calcular pareto de paradas' });
  }
});

// Histórico REAL do OEE de um turno — as últimas N ocorrências dele
// (normalmente uma por dia), com os números brutos de cada uma. O cálculo
// de % (Disponibilidade/Performance/Qualidade/OEE) fica por conta de quem
// consome, igual já é feito pro turno atual — mesma fórmula, mesma fonte.
app.get('/api/oee/historico', async (req, res) => {
  const turnoKey = req.query.turnoKey;
  const quantidade = Math.min(60, Math.max(1, Number(req.query.quantidade) || 14));
  if (!turnoKey) return res.status(400).json({ error: 'Informe turnoKey.' });
  try {
    const turnoRes = await db.query('SELECT * FROM turnos_config WHERE turno_key = $1', [turnoKey]);
    if (turnoRes.rows.length === 0) return res.json({ turnoKey, nome: null, velocidadeNominalPpm: 50, pontos: [] });
    const row = turnoRes.rows[0];

    const cfgRes = await db.query('SELECT * FROM oee_config WHERE id = 1');
    const cfg = cfgRes.rows[0] || {};
    const zeradoEm = cfg.zerado_em ? new Date(cfg.zerado_em) : null;
    const configured = !!(cfg.field_tempo_rodando && cfg.field_contagem_total);

    const velocidadeNominalDoPlc = await influxLatestValue(cfg.field_velocidade_nominal);
    const velocidadeNominalPpm = velocidadeNominalDoPlc !== null
      ? Number(velocidadeNominalDoPlc)
      : (Number(cfg.velocidade_nominal_ppm) || 50);

    const now = new Date();
    const ocorrencias = ultimasOcorrencias(row, now, quantidade).reverse(); // mais antiga primeiro, pro gráfico

    const pontos = [];
    for (const occ of ocorrencias) {
      const metrics = configured
        ? await calcularMetricasTurno(cfg, occ, zeradoEm)
        : { runTimeSec: 0, totalCount: 0, refugoCount: 0, goodCount: 0 };
      pontos.push({
        data: occ.start.toISOString(),
        label: occ.start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        isAtual: occ.isAtual,
        plannedSeg: metrics.plannedSeg,
        runTimeSec: metrics.runTimeSec,
        totalCount: metrics.totalCount,
        refugoCount: metrics.refugoCount,
        goodCount: metrics.goodCount
      });
    }

    res.json({ turnoKey, nome: row.nome, velocidadeNominalPpm, pontos });
  } catch (err) {
    console.error('Erro ao buscar histórico do OEE:', err);
    res.status(500).json({ error: 'Erro ao buscar histórico do OEE' });
  }
});

// Tendência DENTRO do turno selecionado: um ponto de OEE GLOBAL a cada 15
// minutos, cada um calculado só com o que aconteceu NAQUELE intervalo (não
// acumulado desde o início do turno) — mostra pro operador como o
// desempenho variou janela a janela ao longo do próprio turno (diferente do
// /api/oee/historico, que compara um turno inteiro com os de outros dias).
// O eixo X sempre cobre o turno inteiro; se o turno ainda está rolando, os
// pontos só existem até agora — o resto do eixo fica em branco, mostrando
// visualmente quanto turno ainda falta.
app.get('/api/oee/tendencia-turno', async (req, res) => {
  const turnoKey = req.query.turnoKey;
  if (!turnoKey) return res.status(400).json({ error: 'Informe turnoKey.' });
  try {
    const turnoRes = await db.query('SELECT * FROM turnos_config WHERE turno_key = $1', [turnoKey]);
    if (turnoRes.rows.length === 0) {
      return res.json({ turnoKey, nome: null, metaOee: 80, velocidadeNominalPpm: 50, inicio: null, fimProgramado: null, isAtual: false, pontos: [] });
    }
    const row = turnoRes.rows[0];

    const cfgRes = await db.query('SELECT * FROM oee_config WHERE id = 1');
    const cfg = cfgRes.rows[0] || {};
    const configured = !!(cfg.field_tempo_rodando && cfg.field_contagem_total);

    const velocidadeNominalDoPlc = await influxLatestValue(cfg.field_velocidade_nominal);
    const velocidadeNominalPpm = velocidadeNominalDoPlc !== null
      ? Number(velocidadeNominalDoPlc)
      : (Number(cfg.velocidade_nominal_ppm) || 50);

    const now = new Date();
    const occ = ocorrenciaCompleta(row, now);

    if (!occ || !configured) {
      const fallback = ocorrenciaNoDia(row, now, 0);
      return res.json({
        turnoKey, nome: row.nome, metaOee: Number(row.meta_oee), velocidadeNominalPpm,
        inicio: fallback.start.toISOString(), fimProgramado: fallback.end.toISOString(),
        isAtual: false, pontos: []
      });
    }

    const sampleEnd = occ.isAtual ? now : occ.endProgramado;

    // Ponto a cada 15 minutos fixos — cada um mostra o OEE GLOBAL só
    // daquele intervalo (não acumulado desde o início do turno), pra dar
    // pro operador uma leitura de "como estive nos últimos 15 minutos",
    // janela a janela. Só entram janelas COMPLETAS: se "agora" cai no meio
    // de uma janela de 15min, ela ainda não aparece — um pedaço de janela
    // (ex: só 1 minuto) dá uma leitura extremamente instável e incompatível
    // com o resto do gráfico (qualquer produção contínua nesse pedacinho
    // dispara o OEE lá em cima, mesmo que o turno como um todo esteja indo
    // mal), então é melhor esperar ela fechar do que mostrar um valor
    // enganoso.
    const INTERVALO_MIN = 15;
    const boundaries = [occ.start];
    for (let t = occ.start.getTime() + INTERVALO_MIN * 60000; t <= sampleEnd.getTime(); t += INTERVALO_MIN * 60000) {
      boundaries.push(new Date(t));
    }

    const pontos = [];
    for (let i = 1; i < boundaries.length; i++) {
      const janelaInicio = boundaries[i - 1];
      const janelaFim = boundaries[i];
      const elapsedSeg = Math.max(0, (janelaFim.getTime() - janelaInicio.getTime()) / 1000);
      // zeradoEm sempre null aqui, de propósito: o gráfico de tendência
      // nunca deve "apagar" pontos passados por causa de um "Zerar" — ele
      // sempre mostra o que realmente aconteceu em cada janela de 15min,
      // independente de qualquer reset feito no turno depois.
      const metrics = await calcularMetricasTurno(
        cfg,
        { start: janelaInicio, end: janelaFim, plannedSeg: elapsedSeg, isAtual: false },
        null
      );
      pontos.push({
        tempoMs: janelaFim.getTime(),
        label: janelaFim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        plannedSeg: metrics.plannedSeg,
        runTimeSec: metrics.runTimeSec,
        totalCount: metrics.totalCount,
        refugoCount: metrics.refugoCount,
        goodCount: metrics.goodCount
      });
    }

    res.json({
      turnoKey, nome: row.nome, metaOee: Number(row.meta_oee), velocidadeNominalPpm,
      inicio: occ.start.toISOString(), fimProgramado: occ.endProgramado.toISOString(),
      isAtual: occ.isAtual, pontos
    });
  } catch (err) {
    console.error('Erro ao buscar tendência do turno:', err);
    res.status(500).json({ error: 'Erro ao buscar tendência do turno' });
  }
});

// Linha do tempo visual do turno: blocos verdes (produzindo) e vermelhos
// (parado), do início até "agora" (ou até o fim programado, se o turno já
// terminou) — pra tela de OEE, junto do gráfico de tendência. Reaproveita
// direto a tabela `paradas` (já mantida pelo detector automático + pela
// classificação do operador): cada parada vira um bloco vermelho, e o que
// sobra entre elas (e antes da primeira / depois da última) vira bloco
// verde — não precisa reprocessar a tag booleana de novo.
app.get('/api/oee/timeline', async (req, res) => {
  const turnoKey = req.query.turnoKey;
  if (!turnoKey) return res.status(400).json({ error: 'Informe turnoKey.' });
  try {
    const turnoRes = await db.query('SELECT * FROM turnos_config WHERE turno_key = $1', [turnoKey]);
    if (turnoRes.rows.length === 0) {
      return res.json({ turnoKey, nome: null, inicio: null, fim: null, fimProgramado: null, isAtual: false, blocos: [] });
    }
    const row = turnoRes.rows[0];
    const now = new Date();
    const occ = ocorrenciaCompleta(row, now);

    if (!occ) {
      const fallback = ocorrenciaNoDia(row, now, 0);
      return res.json({
        turnoKey, nome: row.nome,
        inicio: fallback.start.toISOString(), fim: fallback.start.toISOString(), fimProgramado: fallback.end.toISOString(),
        isAtual: false, blocos: []
      });
    }

    const sampleEnd = occ.isAtual ? now : occ.endProgramado;
    if (occ.start.getTime() >= sampleEnd.getTime()) {
      return res.json({
        turnoKey, nome: row.nome, inicio: occ.start.toISOString(), fim: sampleEnd.toISOString(),
        fimProgramado: occ.endProgramado.toISOString(), isAtual: occ.isAtual, blocos: []
      });
    }

    const paradasRes = await db.query(
      `SELECT p.iniciado_em, p.finalizado_em, m.nome AS motivo_nome, m.tipo AS motivo_tipo
       FROM paradas p
       LEFT JOIN motivos_parada m ON m.id = p.motivo_id
       WHERE p.iniciado_em < $2
         AND (p.finalizado_em IS NULL OR p.finalizado_em > $1)
       ORDER BY p.iniciado_em ASC`,
      [occ.start.toISOString(), sampleEnd.toISOString()]
    );

    const blocos = [];
    let cursor = occ.start;
    for (const p of paradasRes.rows) {
      const paradaInicio = new Date(Math.max(new Date(p.iniciado_em).getTime(), occ.start.getTime()));
      const paradaFimBruta = p.finalizado_em ? new Date(p.finalizado_em) : sampleEnd;
      const paradaFim = new Date(Math.min(paradaFimBruta.getTime(), sampleEnd.getTime()));
      if (paradaFim.getTime() <= cursor.getTime()) continue; // sobreposição/ordem estranha, pula

      // Bloco verde antes desta parada (o que rodou desde o cursor até ela começar)
      if (paradaInicio.getTime() > cursor.getTime()) {
        blocos.push({
          status: 'rodando',
          inicio: cursor.toISOString(), fim: paradaInicio.toISOString(),
          duracaoSeg: Math.round((paradaInicio.getTime() - cursor.getTime()) / 1000)
        });
      }

      // Bloco vermelho da própria parada
      blocos.push({
        status: 'parada',
        inicio: paradaInicio.toISOString(), fim: paradaFim.toISOString(),
        duracaoSeg: Math.round((paradaFim.getTime() - paradaInicio.getTime()) / 1000),
        motivo: p.motivo_nome || null,
        motivoTipo: p.motivo_tipo || null,
        emAberto: !p.finalizado_em
      });

      cursor = paradaFim;
    }

    // Bloco verde final, do fim da última parada até agora/fim do turno
    if (sampleEnd.getTime() > cursor.getTime()) {
      blocos.push({
        status: 'rodando',
        inicio: cursor.toISOString(), fim: sampleEnd.toISOString(),
        duracaoSeg: Math.round((sampleEnd.getTime() - cursor.getTime()) / 1000)
      });
    }

    res.json({
      turnoKey, nome: row.nome,
      inicio: occ.start.toISOString(), fim: sampleEnd.toISOString(), fimProgramado: occ.endProgramado.toISOString(),
      isAtual: occ.isAtual, blocos
    });
  } catch (err) {
    console.error('Erro ao buscar linha do tempo do turno:', err);
    res.status(500).json({ error: 'Erro ao buscar linha do tempo do turno' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Backend rodando na porta ${PORT}`);
});