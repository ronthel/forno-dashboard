const { Pool } = require('pg');
require('dotenv').config();

// Conexão única com o PostgreSQL, compartilhada por todo o backend
// (server.js e routes/auth.js). Antes existiam duas conexões separadas
// com nomes de variável diferentes (POSTGRES_* e PG_*) — unificado aqui.
//
// Sem valores hardcoded como fallback: se as variáveis de ambiente não
// estiverem definidas no .env, a aplicação deve falhar de forma visível
// em vez de silenciosamente usar uma senha padrão.
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'forno_db',
  port: process.env.POSTGRES_PORT || 5432,
});

// Inicializa tabelas de usuários/autenticação
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'operador'
    );

    CREATE TABLE IF NOT EXISTS dashboards (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      config JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(queryText);
    console.log('[PostgreSQL] Tabelas de usuários prontas.');
  } catch (err) {
    console.error('[PostgreSQL] Erro ao inicializar tabelas de usuários:', err.message);
  }
};

initDb();

module.exports = pool;
