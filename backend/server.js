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
      CREATE TABLE IF NOT EXISTS dashboard_layouts (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) DEFAULT 'default_user',
        charts_config JSONB NOT NULL,
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

      CREATE TABLE IF NOT EXISTS sensores_config (
        field_name VARCHAR(100) PRIMARY KEY,
        descricao VARCHAR(200),
        unidade VARCHAR(20),
        min_limit NUMERIC(10,2),
        max_limit NUMERIC(10,2),
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

// Remove uma variável desativada de qualquer gráfico onde ela apareça no
// layout salvo do dashboard — chamado só ao DESATIVAR (reativar não devolve
// a variável aos gráficos automaticamente, o usuário adiciona de novo se
// quiser). Se um gráfico ficar sem nenhuma variável depois da remoção, o
// gráfico inteiro é removido (não faz sentido um card vazio). Segue o mesmo
// padrão de "sempre INSERT" já usado por POST /api/dashboard/layout — nunca
// sobrescreve o histórico de layouts antigos, só acrescenta a versão nova.
//
// Os layouts agora são pessoais por usuário (ver GET/POST /api/dashboard/layout
// abaixo), então uma variável desativada precisa ser limpa do layout de
// TODOS os usuários que a tinham num gráfico — não só de um único "dono".
async function removeFieldFromSavedLayout(fieldName) {
  try {
    // Último layout salvo de cada usuário (um dashboard_layouts por user_id,
    // pegando sempre a linha mais recente — o histórico de versões antigas
    // não é tocado).
    const latestPerUser = await db.query(
      `SELECT DISTINCT ON (user_id) user_id, charts_config
       FROM dashboard_layouts
       ORDER BY user_id, id DESC`
    );

    let anyChanged = false;
    for (const row of latestPerUser.rows) {
      const stored = row.charts_config;
      // Compatibilidade com o formato antigo (array puro de gráficos, sem
      // refreshInterval/timeRange) — ver GET /api/dashboard/layout abaixo.
      const isOldFormat = Array.isArray(stored);
      const charts = isOldFormat ? stored : (stored?.charts || []);
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

      const newConfig = isOldFormat ? updatedCharts : { ...stored, charts: updatedCharts };
      await db.query(
        'INSERT INTO dashboard_layouts (user_id, charts_config) VALUES ($1, $2)',
        [row.user_id, JSON.stringify(newConfig)]
      );
      anyChanged = true;
    }

    return anyChanged;
  } catch (err) {
    console.error('Erro ao remover variável desativada do layout salvo do dashboard:', err.message);
    return false;
  }
}

// Importação das rotas do InfluxDB
const influxRoutes = require('./routes/influx');
app.use('/api/influx', influxRoutes);

// Importação das rotas de autenticação (login, registro)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// --- ROTAS DO LAYOUT (POSTGRESQL) ---
// charts_config guarda um objeto { charts, refreshInterval, timeRange } —
// além de quais gráficos existem, também as preferências de visualização
// (visibilidade de cada pena já vem dentro de cada gráfico em "charts";
// atualização e atalho de período são globais do dashboard).
//
// O layout é pessoal: cada usuário logado só vê e só sobrescreve o próprio
// (identificado pelo id do token, gravado em user_id como string). Um
// usuário nunca enxerga o dashboard salvo por outro.
app.get('/api/dashboard/layout', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT charts_config FROM dashboard_layouts WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [String(req.user.id)]
    );
    if (result.rows.length === 0) {
      // "isNew" distingue "nunca foi salvo nada ainda" de "foi salvo um
      // layout vazio de propósito" — os dois casos pareciam idênticos pro
      // frontend antes (ambos {charts: []}), e ele tratava um layout vazio
      // salvo deliberadamente como se fosse "primeira vez", repopulando com
      // os gráficos padrão sempre que a página recarregava.
      return res.json({ charts: [], isNew: true });
    }
    const stored = result.rows[0].charts_config;
    // Compatibilidade com layouts salvos antes desta mudança, que guardavam
    // só o array de gráficos direto (sem as preferências extras).
    res.json(Array.isArray(stored) ? { charts: stored } : stored);
  } catch (err) {
    res.json({ charts: [] });
  }
});

app.post('/api/dashboard/layout', requireAuth, async (req, res) => {
  const { charts, refreshInterval, timeRange } = req.body;
  try {
    await db.query(
      'INSERT INTO dashboard_layouts (user_id, charts_config) VALUES ($1, $2)',
      [String(req.user.id), JSON.stringify({ charts, refreshInterval, timeRange })]
    );

    logAudit({
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'salvou layout do dashboard',
      details: { totalGraficos: Array.isArray(charts) ? charts.length : 0 }
    });

    res.json({ message: 'Layout salvo!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar layout' });
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

// --- ROTA DE MÉTRICAS OEE ---
app.get('/api/oee/metrics', async (req, res) => {
  try {
    // tag_events e formato longo (uma linha por tag) - pega a leitura mais
    // recente de CADA uma das 3 tags separadamente, em vez de uma linha so
    // com as 3 colunas juntas (que so existia no formato antigo "Variaveis").
    const sqlQuery = `
      SELECT tag_name, value_num, time
      FROM "tag_events"
      WHERE tag_name IN ('RUN_TIME_SEC', 'TOTAL_COUNT', 'GOOD_COUNT')
      ORDER BY time DESC
      LIMIT 30
    `;

    const reader = await influxDB.query(sqlQuery);
    const latestByTag = {};

    for await (const row of reader) {
      // ja ordenado por tempo DESC - a primeira ocorrencia de cada tag_name e a mais recente
      if (!(row.tag_name in latestByTag)) {
        latestByTag[row.tag_name] = row.value_num;
      }
    }

    res.json({
      runTimeSec: Number(latestByTag.RUN_TIME_SEC || 0),
      totalCount: Number(latestByTag.TOTAL_COUNT || 0),
      goodCount: Number(latestByTag.GOOD_COUNT || 0)
    });
  } catch (err) {
    console.error('[Erro OEE Metrics]:', err.message);
    res.json({ runTimeSec: 0, totalCount: 0, goodCount: 0 });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Backend rodando na porta ${PORT}`);
});