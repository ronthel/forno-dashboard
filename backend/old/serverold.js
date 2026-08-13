const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { InfluxDBClient } = require('@influxdata/influxdb3-client');
require('dotenv').config();

// Inicialização do Express
const app = express();
app.use(cors());
app.use(express.json());

// Configuração do Cliente InfluxDB 3
const hostUrl = process.env.INFLUX_URL || 'http://localhost:8181';
const formattedHost = hostUrl.startsWith('http') ? hostUrl : `http://${hostUrl}`;

const influxDB = new InfluxDBClient({
  host: formattedHost,
  token: process.env.INFLUX_TOKEN || 'apiv3_z5n3x48K8Gxu5-8aUoVtEwgy-Nrf1c_RGcjXX9EkZ4twxkcrNMSi9PIldyNLWF8u4K-K4KJzcb48QwSYoHcpzg',
  database: process.env.INFLUX_BUCKET || 'forno'
});

// Configuração de Conexão com o PostgreSQL
const db = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin123',
  database: process.env.POSTGRES_DB || 'forno_db',
  port: process.env.POSTGRES_PORT || 5432,
});

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

// --- ROTA DE MÉTRICAS OEE (Corrigida com nomes maiúsculos e entre aspas) ---
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