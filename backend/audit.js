const pool = require('./db');

// Registra uma linha no histórico de auditoria (quem fez, quando, o quê).
// Usado por qualquer rota que altere dados do sistema (config de turnos/
// sensores, layout do dashboard, usuários, login).
//
// Nunca deixa a auditoria travar a operação principal: se a gravação do log
// falhar por algum motivo, só avisa no console e segue em frente — a ação
// original (que já aconteceu) não é desfeita nem bloqueada por causa disso.
async function logAudit({ userId, username, role, action, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, role, action, details) VALUES ($1, $2, $3, $4, $5)`,
      [
        userId || null,
        username || 'desconhecido',
        role || null,
        action,
        details !== undefined ? JSON.stringify(details) : null
      ]
    );
  } catch (err) {
    console.error('[Auditoria] Falha ao registrar log:', err.message);
  }
}

module.exports = { logAudit };
