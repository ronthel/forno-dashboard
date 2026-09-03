// Rótulo e cor de cada tipo de alarme (limit_type) — único lugar de verdade,
// usado tanto na Central de Alarmes (AlarmsView) quanto no modal de detalhe
// (AlarmModal), pra nunca desalinhar um do outro.
const TIPOS = {
  MAX: { label: 'Excesso (máx)', badge: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  MIN: { label: 'Queda (mín)', badge: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
  // Alarmes de infraestrutura (verificarSaudeSistema, em server.js) — não
  // são um limite numérico cruzado, são "a conexão caiu" — por isso um
  // rótulo e cor próprios, em vez de cair errado em "Queda (mín)".
  CONEXAO: { label: 'Falha de conexão', badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
};

export function tipoAlarmeInfo(limitType) {
  return TIPOS[limitType] || TIPOS.MIN;
}
