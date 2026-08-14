const express = require('express');
const cors = require('cors');
const { InfluxDBClient } = require('@influxdata/influxdb3-client');
require('dotenv').config();

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
    `);
    console.log('[PostgreSQL] Conectado e tabelas prontas.');
  } catch (err) {
    console.warn('[PostgreSQL Aviso] Não foi possível conectar:', err.message);
  }
}
initPostgres();

// Importação das rotas do InfluxDB
const influxRoutes = require('./routes/influx');
app.use('/api/influx', influxRoutes);

// Importação das rotas de autenticação (login, registro)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// --- ROTAS DO LAYOUT (POSTGRESQL) ---
app.get('/api/dashboard/layout', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT charts_config FROM dashboard_layouts WHERE user_id = 'default_user' ORDER BY id DESC LIMIT 1"
    );
    res.json(result.rows.length > 0 ? result.rows[0].charts_config : []);
  } catch (err) {
    res.json([]);
  }
});

app.post('/api/dashboard/layout', async (req, res) => {
  const { charts } = req.body;
  try {
    await db.query(
      "INSERT INTO dashboard_layouts (user_id, charts_config) VALUES ('default_user', $1)",
      [JSON.stringify(charts)]
    );
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

app.post('/api/config/turnos', async (req, res) => {
  try {
    const turnos = req.body;
    for (const [key, val] of Object.entries(turnos)) {
      await db.query(
        `INSERT INTO turnos_config (turno_key, nome, hora_inicio, hora_fim, meta_oee) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (turno_key) DO UPDATE 
         SET nome = EXCLUDED.nome, hora_inicio = EXCLUDED.hora_inicio, hora_fim = EXCLUDED.hora_fim, meta_oee = EXCLUDED.meta_oee`,
        [key, val.nome, val.inicio, val.fim, val.metaOee]
      );
    }
    res.json({ success: true, message: 'Turnos salvos com sucesso no PostgreSQL!' });
  } catch (err) {
    console.error('Erro ao salvar turnos:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- ROTAS DE CONFIGURAÇÃO DE SENSORES / VARIÁVEIS ---
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
        tipoAlarme: row.tipo_alarme
      };
    });
    res.json(configs);
  } catch (err) {
    console.error('Erro ao buscar sensores:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/config/sensores', async (req, res) => {
  try {
    const sensores = req.body;
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
    res.json({ success: true, message: 'Sensores salvos com sucesso no PostgreSQL!' });
  } catch (err) {
    console.error('Erro ao salvar sensores:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- ROTAS DE ALARMES ---
app.post('/api/alarms', async (req, res) => {
  const { fieldName, valueRead, limitType, limitValue } = req.body;
  try {
    await db.query(
      `INSERT INTO alarm_history (field_name, value_read, limit_type, limit_value) VALUES ($1, $2, $3, $4)`,
      [fieldName, valueRead, limitType, limitValue]
    );
    res.json({ message: 'Alarme registrado!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alarms', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, field_name, value_read, limit_type, limit_value, 
              TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') as formatted_date
       FROM alarm_history ORDER BY id DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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