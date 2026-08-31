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

// Sem esse listener, um erro em um client ocioso do pool (ex.: o Postgres
// derrubando a conexão com "terminating connection due to administrator
// command") vira uma exceção não tratada e derruba o processo Node inteiro
// (visto em produção em 28/08/2026). O pool já descarta o client com
// problema sozinho — aqui só evitamos que isso mate o servidor.
pool.on('error', (err) => {
  console.error('[PostgreSQL] Erro em client ocioso do pool (ignorado, processo continua no ar):', err.message);
});

// Inicializa tabelas de usuários/autenticação e de auditoria
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'operador'
    );

    -- Força o usuário a trocar a senha no próximo login. Usado para contas
    -- criadas por um administrador (a senha inicial foi escolhida por outra
    -- pessoa, então por segurança o dono da conta precisa defini-la de novo).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS dashboards (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      config JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Trilha de auditoria: uma linha por alteração feita no sistema (quem,
    -- quando, o quê). "username"/"role" ficam gravados como uma cópia do
    -- momento da ação (não uma referência viva a "users") — assim o
    -- histórico continua legível mesmo que o usuário seja excluído depois.
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INT,
      username VARCHAR(50) NOT NULL,
      role VARCHAR(20),
      action VARCHAR(150) NOT NULL,
      details JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(queryText);
    console.log('[PostgreSQL] Tabelas de usuários e auditoria prontas.');
  } catch (err) {
    console.error('[PostgreSQL] Erro ao inicializar tabelas de usuários:', err.message);
  }
};

initDb();

module.exports = pool;
