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

// Extrai o usuário do token, se houver — usado só para IDENTIFICAR quem fez
// uma ação em rotas que continuam abertas de propósito (ex.: salvar layout),
// não para bloquear o acesso. Se não houver token válido, retorna null e a
// ação segue normalmente, só sem um autor identificado no log de auditoria.
const getUserFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
};

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
const PLC_SERVICE_API_PORT = process.env.PLC_SERVICE_API_PORT || 8787;
const MONITORED_TAGS_FILE = path.join(__dirname, '..', 'plc-service', 'monitored_tags.json');

function fetchPlcServiceJson(reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: PLC_SERVICE_API_PORT, path: reqPath, timeout: 4000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Reescreve plc-service/monitored_tags.json com as variáveis ATIVAS no
// PostgreSQL — chamado depois de qualquer alteração em sensores_config.
// Se a consulta falhar, ou não houver nenhuma variável ativa, deixamos o
// arquivo como está (nunca escrevemos uma lista vazia) para não parar a
// coleta de dados por causa de um erro passageiro no backend.
async function regenerateMonitoredTagsFile() {
  try {
    const result = await db.query('SELECT field_name FROM sensores_config WHERE ativo = TRUE ORDER BY field_name');
    const fields = result.rows.map((r) => r.field_name);
    if (fields.length === 0) {
      console.warn('[plc-service] Nenhuma variável ativa encontrada — não sobrescrevendo monitored_tags.json para não parar a coleta.');
      return;
    }
    fs.writeFileSync(MONITORED_TAGS_FILE, JSON.stringify(fields, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao atualizar monitored_tags.json:', err.message);
  }
}

// Remove uma variável desativada de qualquer gráfico onde ela apareça no
// layout salvo do dashboard — chamado só ao DESATIVAR (reativar não devolve
// a variável aos gráficos automaticamente, o usuário adiciona de novo se
// quiser). Se um gráfico ficar sem nenhuma variável depois da remoção, o
// gráfico inteiro é removido (não faz sentido um card vazio). Segue o mesmo
// padrão de "sempre INSERT" já usado por POST /api/dashboard/layout — nunca
// sobrescreve o histórico de layouts antigos, só acrescenta a versão nova.
async function removeFieldFromSavedLayout(fieldName) {
  try {
    const result = await db.query(
      "SELECT charts_config FROM dashboard_layouts WHERE user_id = 'default_user' ORDER BY id DESC LIMIT 1"
    );
    if (result.rows.length === 0) return false;

    const stored = result.rows[0].charts_config;
    // Compatibilidade com o formato antigo (array puro de gráficos, sem
    // refreshInterval/timeRange) — ver GET /api/dashboard/layout abaixo.
    const isOldFormat = Array.isArray(stored);
    const charts = isOldFormat ? stored : (stored?.charts || []);
    if (!Array.isArray(charts) || charts.length === 0) return false;

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

    if (!changed) return false;

    const newConfig = isOldFormat ? updatedCharts : { ...stored, charts: updatedCharts };
    await db.query(
      "INSERT INTO dashboard_layouts (user_id, charts_config) VALUES ('default_user', $1)",
      [JSON.stringify(newConfig)]
    );
    return true;
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
app.get('/api/dashboard/layout', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT charts_config FROM dashboard_layouts WHERE user_id = 'default_user' ORDER BY id DESC LIMIT 1"
    );
    if (result.rows.length === 0) {
      return res.json({ charts: [] });
    }
    const stored = result.rows[0].charts_config;
    // Compatibilidade com layouts salvos antes desta mudança, que guardavam
    // só o array de gráficos direto (sem as preferências extras).
    res.json(Array.isArray(stored) ? { charts: stored } : stored);
  } catch (err) {
    res.json({ charts: [] });
  }
});

app.post('/api/dashboard/layout', async (req, res) => {
  const { charts, refreshInterval, timeRange } = req.body;
  try {
    await db.query(
      "INSERT INTO dashboard_layouts (user_id, charts_config) VALUES ('default_user', $1)",
      [JSON.stringify({ charts, refreshInterval, timeRange })]
    );

    // Rota aberta de propósito (sem exigir login) — se mesmo assim vier um
    // token válido (caso normal, já que só a tela logada chama isso), usamos
    // ele só para identificar o autor no log de auditoria.
    const user = getUserFromRequest(req);
    logAudit({
      userId: user?.id,
      username: user?.username,
      role: user?.role,
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

    await regenerateMonitoredTagsFile();

    res.json({ success: true, message: 'Sensores salvos com sucesso no PostgreSQL!' });
  } catch (err) {
    console.error('Erro ao salvar sensores:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Desativa uma variável: pára de ser monitorada (some do monitored_tags.json
// que o plc-service usa) mas o histórico já gravado no InfluxDB e a própria
// linha em sensores_config continuam intactos — pode ser reativada depois.
app.put('/api/config/sensores/:fieldName/desativar', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const { fieldName } = req.params;
  try {
    const result = await db.query(
      'UPDATE sensores_config SET ativo = FALSE WHERE field_name = $1 RETURNING field_name',
      [fieldName]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Variável não encontrada.' });
    }

    await regenerateMonitoredTagsFile();
    const removidoDosGraficos = await removeFieldFromSavedLayout(fieldName);

    logAudit({
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'desativou variável de monitoramento',
      details: { fieldName, removidoDosGraficosSalvos: removidoDosGraficos }
    });

    res.json({ success: true, message: `Variável "${fieldName}" desativada.` });
  } catch (err) {
    console.error('Erro ao desativar sensor:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Reativa uma variável desativada — volta a ser monitorada e escrita no
// monitored_tags.json (a configuração antiga, descrição/limites/cor, etc.,
// continua a mesma de antes da desativação).
app.put('/api/config/sensores/:fieldName/reativar', requireRole(['supervisor', 'administrador']), async (req, res) => {
  const { fieldName } = req.params;
  try {
    const result = await db.query(
      'UPDATE sensores_config SET ativo = TRUE WHERE field_name = $1 RETURNING field_name',
      [fieldName]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Variável não encontrada.' });
    }

    await regenerateMonitoredTagsFile();

    logAudit({
      userId: req.user.id,
      username: req.user.username,
      role: req.user.role,
      action: 'reativou variável de monitoramento',
      details: { fieldName }
    });

    res.json({ success: true, message: `Variável "${fieldName}" reativada.` });
  } catch (err) {
    console.error('Erro ao reativar sensor:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Lista as tags que o PLC expõe (via API local do plc-service) para o
// picker de "Adicionar nova variável" — restrito a quem pode alterar
// configuração, já que expõe os nomes internos das tags do controlador.
app.get('/api/plc/tags', requireRole(['supervisor', 'administrador']), async (req, res) => {
  try {
    const data = await fetchPlcServiceJson('/tags');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Não foi possível consultar as tags do PLC. Verifique se o pipeline (plc-service) está rodando.' });
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
    const sqlQuery = `
      SELECT "RUN_TIME_SEC", "TOTAL_COUNT", "GOOD_COUNT" 
      FROM "Variaveis" 
      ORDER BY time DESC 
      LIMIT 1
    `;

    const reader = await influxDB.query(sqlQuery);
    let latest = {};

    for await (const row of reader) {
      latest = row;
      break; 
    }

    res.json({
      runTimeSec: Number(latest.RUN_TIME_SEC || 0),
      totalCount: Number(latest.TOTAL_COUNT || 0),
      goodCount: Number(latest.GOOD_COUNT || 0)
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