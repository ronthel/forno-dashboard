// Helpers pra pré-preencher os filtros de período (inputs <input
// type="datetime-local">) com o dia de hoje — usado pelas telas de Alarmes
// e Auditoria, que agora mostram só hoje por padrão; outros períodos
// continuam disponíveis mudando "De"/"Até" e clicando em Filtrar.
function paraDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hojeInicioLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return paraDatetimeLocal(d);
}

export function agoraLocal() {
  return paraDatetimeLocal(new Date());
}
