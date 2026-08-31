// Fórmula oficial do OEE (Disponibilidade × Performance × Qualidade) — único
// lugar de verdade, usado pelo turno atual (OeeView), pelo gráfico de
// tendência e pelo Relatório Executivo. Nunca duplicar essa conta em outro
// arquivo — sempre importar daqui.
//
// `ponto` = { plannedSeg, runTimeSec, totalCount, refugoCount, goodCount }
export function calcularMetricasOee(ponto, velocidadeNominalPpm) {
  const availability = ponto.plannedSeg > 0 ? Math.min(100, (ponto.runTimeSec / ponto.plannedSeg) * 100) : 0;
  const velocidadeReaMediaPpm = ponto.runTimeSec > 0 ? (ponto.totalCount / (ponto.runTimeSec / 60)) : 0;
  const performance = velocidadeNominalPpm > 0 ? Math.min(100, (velocidadeReaMediaPpm / velocidadeNominalPpm) * 100) : 0;
  const quality = ponto.totalCount > 0 ? Math.min(100, (ponto.goodCount / ponto.totalCount) * 100) : 100;
  const oee = (availability * performance * quality) / 10000;
  return { availability, performance, quality, oee };
}

// Atalho pra quando só o número final do OEE interessa (ex: um ponto do
// gráfico de tendência).
export function calcularOeePonto(ponto, velocidadeNominalPpm) {
  return Number(calcularMetricasOee(ponto, velocidadeNominalPpm).oee.toFixed(1));
}
