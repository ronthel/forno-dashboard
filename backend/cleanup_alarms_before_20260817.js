// Script de uso único: remove do histórico de alarmes (alarm_history) todos
// os registros com data de disparo anterior a 17/08/2026 (mantém os
// registros do próprio dia 17/08 em diante).
//
// Uso: dentro da pasta backend/, rode "node cleanup_alarms_before_20260817.js".
// Pode apagar este arquivo depois de rodar — é de uso único.
require('dotenv').config();
const db = require('./db');

(async () => {
  try {
    const result = await db.query(
      `DELETE FROM alarm_history WHERE created_at < '2026-08-17 00:00:00' RETURNING id, field_name, value_read, status, created_at`
    );
    if (result.rowCount === 0) {
      console.log('Nenhum registro anterior a 17/08/2026 encontrado — nada para remover.');
    } else {
      console.log(`Removidos ${result.rowCount} registro(s) de alarme anteriores a 17/08/2026:`);
      result.rows.forEach((r) => {
        console.log(`  #${r.id} — ${r.field_name} — valor ${r.value_read} — status ${r.status} — disparado em ${r.created_at}`);
      });
    }
  } catch (err) {
    console.error('Erro ao limpar registros:', err.message);
  } finally {
    process.exit(0);
  }
})();
