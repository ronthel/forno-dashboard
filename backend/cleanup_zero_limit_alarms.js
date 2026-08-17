// Script de uso único: remove do histórico de alarmes os registros com
// limit_value = 0 — a assinatura exata do bug de falso disparo no
// carregamento (ChartCard avaliava o alarme antes da configuração real do
// sensor chegar, usando 0 como limite mínimo/máximo por engano). Já
// corrigido no código; este script só limpa o ruído que ficou no banco.
//
// Uso: dentro da pasta backend/, rode "node cleanup_zero_limit_alarms.js".
// Pode apagar este arquivo depois de rodar — é de uso único.
require('dotenv').config();
const db = require('./db');

(async () => {
  try {
    const result = await db.query(
      `DELETE FROM alarm_history WHERE limit_value = 0 RETURNING id, field_name, value_read, status, created_at`
    );
    if (result.rowCount === 0) {
      console.log('Nenhum registro com limite 0 encontrado — nada para remover.');
    } else {
      console.log(`Removidos ${result.rowCount} registro(s) de alarme com limite 0 (falso positivo já corrigido):`);
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
