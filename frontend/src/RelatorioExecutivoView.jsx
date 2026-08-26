import React, { useState, useEffect, useCallback } from 'react';
import api, { isOk } from './api';
import jsPDF from 'jspdf';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import {
  ClipboardList, Calendar, Download, Loader2, AlertCircle, TrendingUp, TrendingDown, Minus,
  Package, XCircle, CheckCircle2, BarChart3, Award, AlertTriangle, RefreshCw, Clock
} from 'lucide-react';
import { calcularMetricasOee } from './oeeCalc';
import ProductionTimeline from './ProductionTimeline';

const TURNO_KEYS = ['turnoA', 'turnoB', 'turnoC'];
const ZERO_PONTO = { plannedSeg: 0, runTimeSec: 0, totalCount: 0, refugoCount: 0, goodCount: 0 };
const CORES_TURNO = { turnoA: '#38bdf8', turnoB: '#f59e0b', turnoC: '#a78bfa' };

function agregarTurnos(turnos) {
  return TURNO_KEYS.reduce((acc, key) => {
    const t = turnos?.[key] || ZERO_PONTO;
    return {
      plannedSeg: acc.plannedSeg + (t.plannedSeg || 0),
      runTimeSec: acc.runTimeSec + (t.runTimeSec || 0),
      totalCount: acc.totalCount + (t.totalCount || 0),
      refugoCount: acc.refugoCount + (t.refugoCount || 0),
      goodCount: acc.goodCount + (t.goodCount || 0),
    };
  }, { ...ZERO_PONTO });
}

function formatDuracaoSeg(totalSeg) {
  const seg = Math.max(0, Math.round(totalSeg || 0));
  const h = Math.floor(seg / 3600);
  const min = Math.floor((seg % 3600) / 60);
  if (h > 0) return `${h}h ${min}min`;
  return `${min}min`;
}

function ontemStr() {
  const d = new Date(Date.now() - 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDataBR(dataStr) {
  if (!dataStr) return '';
  const [y, m, d] = dataStr.split('-');
  return `${d}/${m}/${y}`;
}

const Delta = ({ atual, anterior, sufixo = 'pp' }) => {
  const diff = atual - anterior;
  if (Math.abs(diff) < 0.05) {
    return <span className="flex items-center gap-1 text-slate-400 text-xs"><Minus size={12} /> estável</span>;
  }
  const positivo = diff > 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${positivo ? 'text-emerald-400' : 'text-red-400'}`}>
      {positivo ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {positivo ? '+' : ''}{diff.toFixed(1)}{sufixo} vs dia anterior
    </span>
  );
};

// Gera o PDF de 1 página, pronto pra reunião — título, data, OEE do dia com
// comparação, OEE por turno, e Top 5 motivos de parada.
const exportarPdf = (dataStr, turnos, turnosAnterior, velocidadeNominalPpm, pareto) => {
  const doc = new jsPDF();
  const diaMetrics = calcularMetricasOee(agregarTurnos(turnos), velocidadeNominalPpm);
  const diaAnteriorMetrics = calcularMetricasOee(agregarTurnos(turnosAnterior), velocidadeNominalPpm);

  doc.setFontSize(20);
  doc.setTextColor(217, 119, 6);
  doc.text('Relatório Executivo de Produção', 14, 20);
  doc.setFontSize(11);
  doc.setTextColor(80);
  doc.text(`Forno Industrial — ${formatDataBR(dataStr)}`, 14, 28);

  let y = 40;
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text(`OEE do Dia: ${diaMetrics.oee.toFixed(1)}%  (dia anterior: ${diaAnteriorMetrics.oee.toFixed(1)}%)`, 14, y);
  y += 10;

  doc.setFontSize(11);
  doc.text(`Disponibilidade: ${diaMetrics.availability.toFixed(1)}%   Performance: ${diaMetrics.performance.toFixed(1)}%   Qualidade: ${diaMetrics.quality.toFixed(1)}%`, 14, y);
  y += 6;
  const agregado = agregarTurnos(turnos);
  doc.text(`Produção: ${agregado.totalCount} peças (${agregado.goodCount} boas, ${agregado.refugoCount} refugo)`, 14, y);
  y += 10;
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFontSize(12);
  doc.setTextColor(217, 119, 6);
  doc.text('OEE por Turno', 14, y);
  y += 7;
  doc.setFontSize(9);
  doc.setTextColor(100);
  ['Turno', 'OEE', 'Disp.', 'Perf.', 'Qual.', 'Peças'].forEach((label, i) => doc.text(label, 14 + i * 30, y));
  y += 2;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setTextColor(0);
  TURNO_KEYS.forEach((key) => {
    const t = turnos?.[key] || ZERO_PONTO;
    const m = calcularMetricasOee(t, velocidadeNominalPpm);
    const nome = turnos?.[key]?.nome || key;
    [nome, `${m.oee.toFixed(1)}%`, `${m.availability.toFixed(1)}%`, `${m.performance.toFixed(1)}%`, `${m.quality.toFixed(1)}%`, `${t.totalCount}`]
      .forEach((val, i) => doc.text(String(val), 14 + i * 30, y));
    y += 6;
  });
  y += 6;

  if (pareto?.porMotivo?.length > 0) {
    doc.line(14, y, 196, y);
    y += 8;
    doc.setFontSize(12);
    doc.setTextColor(217, 119, 6);
    doc.text('Top Motivos de Parada', 14, y);
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(0);
    pareto.porMotivo.slice(0, 5).forEach((m) => {
      doc.text(`${m.nome} (${m.tipo === 'programada' ? 'programada' : 'não programada'}) — ${m.quantidade}x — ${formatDuracaoSeg(m.totalSeg)}`, 14, y);
      y += 6;
    });
    y += 4;
    if (pareto.mttrSeg != null) {
      doc.text(`MTTR: ${formatDuracaoSeg(pareto.mttrSeg)}    MTBF: ${formatDuracaoSeg(pareto.mtbfSeg)}`, 14, y);
    }
  }

  doc.save(`relatorio_executivo_${dataStr}.pdf`);
};

// Relatório Executivo — resumo de 1 dia inteiro (os 3 turnos), pensado pra
// abrir na reunião de resultados sem precisar navegar entre telas: OEE do
// dia com comparação vs dia anterior, OEE por turno, e Top 5 motivos de
// parada com MTTR/MTBF. Botão de PDF gera o mesmo conteúdo pra imprimir ou
// anexar na ata.
export default function RelatorioExecutivoView({ onBack }) {
  const [dataStr, setDataStr] = useState(ontemStr());
  const [turnos, setTurnos] = useState(null);
  const [turnosAnterior, setTurnosAnterior] = useState(null);
  const [velocidadeNominalPpm, setVelocidadeNominalPpm] = useState(50);
  const [configured, setConfigured] = useState(true);
  const [pareto, setPareto] = useState(null);
  const [semana, setSemana] = useState(null);
  const [timelineDia, setTimelineDia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const carregar = useCallback(async (data) => {
    setLoading(true);
    setError('');
    try {
      const [relRes, paretoRes, semanaRes, timelineRes] = await Promise.all([
        api.get('/api/oee/relatorio-diario', { params: { data } }),
        api.get('/api/paradas/pareto', { params: { startDate: `${data}T00:00:00`, endDate: `${data}T23:59:59` } }),
        api.get('/api/oee/relatorio-semanal', { params: { data } }),
        api.get('/api/oee/timeline-dia', { params: { data } })
      ]);
      if (isOk(relRes)) {
        setTurnos(relRes.data.turnos || {});
        setTurnosAnterior(relRes.data.turnosDiaAnterior || {});
        setVelocidadeNominalPpm(relRes.data.velocidadeNominalPpm || 50);
        setConfigured(!!relRes.data.configured);
      } else {
        setError(relRes.data?.error || 'Erro ao carregar o relatório.');
      }
      if (isOk(paretoRes)) setPareto(paretoRes.data);
      if (isOk(semanaRes)) setSemana(semanaRes.data);
      if (isOk(timelineRes)) setTimelineDia(timelineRes.data);
    } catch (err) {
      setError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(dataStr); }, [dataStr, carregar]);

  const diaMetrics = turnos ? calcularMetricasOee(agregarTurnos(turnos), velocidadeNominalPpm) : null;
  const diaAnteriorMetrics = turnosAnterior ? calcularMetricasOee(agregarTurnos(turnosAnterior), velocidadeNominalPpm) : null;
  const agregado = turnos ? agregarTurnos(turnos) : ZERO_PONTO;

  // Tendência semanal: um ponto de OEE por turno por dia (últimos 7 dias),
  // mais a média da semana de cada turno — pra saber quem está melhor/pior
  // e se a semana está indo em direção à meta.
  const nominalSemana = semana?.velocidadeNominalPpm ?? velocidadeNominalPpm;
  const chartSemana = semana?.dias?.map((dia) => {
    const ponto = { label: dia.label };
    TURNO_KEYS.forEach((key) => {
      const t = dia.turnos?.[key];
      ponto[key] = t ? calcularMetricasOee(t, nominalSemana).oee : null;
    });
    return ponto;
  }) || [];

  const metaSemana = turnos
    ? Math.round(TURNO_KEYS.reduce((acc, k) => acc + (turnos[k]?.metaOee || 80), 0) / TURNO_KEYS.length)
    : 80;

  const mediasSemana = TURNO_KEYS.map((key) => {
    const valores = chartSemana.map((d) => d[key]).filter((v) => v != null);
    const media = valores.length > 0 ? valores.reduce((a, b) => a + b, 0) / valores.length : 0;
    return { key, nome: turnos?.[key]?.nome || key, media };
  });
  const melhorTurno = mediasSemana.length > 0 ? mediasSemana.reduce((a, b) => (b.media > a.media ? b : a)) : null;
  const piorTurno = mediasSemana.length > 0 ? mediasSemana.reduce((a, b) => (b.media < a.media ? b : a)) : null;

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-3 flex flex-col gap-2.5 overflow-y-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-800 pb-2">
        <div>
          <h1 className="text-base font-bold text-amber-500 flex items-center gap-1.5">
            <ClipboardList size={18} /> Relatório Executivo
          </h1>
          <p className="text-slate-400 text-[11px]">Resumo do dia — pronto pra reunião de resultados</p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1">
            <Calendar size={13} className="text-amber-400" />
            <input
              type="date"
              value={dataStr}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDataStr(e.target.value)}
              className="bg-transparent text-slate-100 text-xs focus:outline-none"
            />
          </label>
          <button
            onClick={() => carregar(dataStr)}
            disabled={loading}
            title="Atualizar — útil se o dia escolhido for hoje e o turno ainda estiver rodando"
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => exportarPdf(dataStr, turnos, turnosAnterior, velocidadeNominalPpm, pareto)}
            disabled={!turnos || loading}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-3 py-1 rounded-lg text-xs font-semibold transition"
          >
            <Download size={13} /> Gerar PDF
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-2 rounded">
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {!configured && !loading && (
        <div className="bg-amber-950/40 border border-amber-700 text-amber-200 text-xs rounded-lg px-3 py-1.5">
          O cálculo do OEE ainda não está ligado a nenhuma variável real — os números abaixo estão zerados. Configure em "Parâmetros OEE".
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {/* OEE do dia, grande, com comparação */}
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-xl flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase">OEE do Dia — {formatDataBR(dataStr)}</span>
              <div className="flex items-end gap-3 mt-0.5">
                <span className="text-4xl font-extrabold font-mono text-amber-400">{diaMetrics?.oee.toFixed(1)}%</span>
                {diaMetrics && diaAnteriorMetrics && <Delta atual={diaMetrics.oee} anterior={diaAnteriorMetrics.oee} />}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">Disponibilidade</span>
                <span className="text-lg font-bold text-emerald-400 font-mono">{diaMetrics?.availability.toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">Performance</span>
                <span className="text-lg font-bold text-sky-400 font-mono">{diaMetrics?.performance.toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">Qualidade</span>
                <span className="text-lg font-bold text-orange-400 font-mono">{diaMetrics?.quality.toFixed(1)}%</span>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 bg-slate-900/70 border border-slate-700 rounded-lg px-2.5 py-1.5">
                <Package size={16} className="text-amber-400" />
                <div>
                  <span className="text-slate-400 text-[9px] uppercase font-semibold block">Produzido</span>
                  <span className="text-sm font-bold font-mono">{agregado.totalCount}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-900/70 border border-slate-700 rounded-lg px-2.5 py-1.5">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <div>
                  <span className="text-slate-400 text-[9px] uppercase font-semibold block">Boas</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">{agregado.goodCount}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-900/70 border border-slate-700 rounded-lg px-2.5 py-1.5">
                <XCircle size={16} className="text-red-400" />
                <div>
                  <span className="text-slate-400 text-[9px] uppercase font-semibold block">Refugo</span>
                  <span className="text-sm font-bold font-mono text-red-400">{agregado.refugoCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Linha do tempo do dia inteiro — verde rodando / vermelho
              parado, com o tempo total de cada um logo abaixo da barra
              (o ProductionTimeline já calcula isso sozinho). */}
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2.5 shadow-md">
            <h2 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
              <Clock size={13} className="text-amber-400" /> Equipamento — Rodando x Parado no Dia
            </h2>
            <ProductionTimeline
              blocos={timelineDia?.blocos || []}
              inicio={timelineDia?.inicio}
              fimProgramado={timelineDia?.fimProgramado}
            />
          </div>

          {/* OEE por turno */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {TURNO_KEYS.map((key) => {
              const t = turnos?.[key] || ZERO_PONTO;
              const tAnterior = turnosAnterior?.[key] || ZERO_PONTO;
              const m = calcularMetricasOee(t, velocidadeNominalPpm);
              const mAnterior = calcularMetricasOee(tAnterior, velocidadeNominalPpm);
              const meta = turnos?.[key]?.metaOee || 80;
              return (
                <div key={key} className="bg-slate-800/90 border border-slate-700 rounded-xl p-2.5 shadow-md flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-400 font-bold text-xs uppercase">{turnos?.[key]?.nome || key}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.oee >= meta ? 'bg-emerald-950/60 text-emerald-400' : 'bg-red-950/60 text-red-400'}`}>
                      Meta {meta}%
                    </span>
                  </div>
                  <span className="text-xl font-extrabold font-mono">{m.oee.toFixed(1)}%</span>
                  <Delta atual={m.oee} anterior={mAnterior.oee} />
                  <div className="grid grid-cols-3 gap-1 text-center text-[11px] mt-0.5 pt-1 border-t border-slate-700">
                    <div><span className="text-slate-500 block">Disp.</span><span className="text-slate-200 font-mono">{m.availability.toFixed(0)}%</span></div>
                    <div><span className="text-slate-500 block">Perf.</span><span className="text-slate-200 font-mono">{m.performance.toFixed(0)}%</span></div>
                    <div><span className="text-slate-500 block">Qual.</span><span className="text-slate-200 font-mono">{m.quality.toFixed(0)}%</span></div>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">{t.totalCount} peças ({t.goodCount} boas / {t.refugoCount} refugo)</p>
                </div>
              );
            })}
          </div>

          {/* Tendência semanal (esquerda) + Pareto do dia (direita), lado a
              lado — economiza altura em vez de empilhar os dois cards. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">

          {/* Tendência semanal de OEE por turno, vs meta */}
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2.5 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <h2 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp size={13} className="text-amber-400" /> Tendência da Semana — Meta: {metaSemana}%
              </h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] mb-1.5">
              {melhorTurno && (
                <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                  <Award size={12} /> {melhorTurno.nome}: {melhorTurno.media.toFixed(1)}%
                </span>
              )}
              {piorTurno && piorTurno.key !== melhorTurno?.key && (
                <span className="flex items-center gap-1 text-red-400 font-semibold">
                  <AlertTriangle size={12} /> {piorTurno.nome} precisa atenção: {piorTurno.media.toFixed(1)}%
                </span>
              )}
            </div>

            <div style={{ width: '100%', height: '150px' }} className="bg-slate-900/70 p-1.5 rounded-lg border border-slate-700/60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSemana} margin={{ top: 5, right: 10, left: -15, bottom: -5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9', borderRadius: '6px', fontSize: '11px' }}
                    formatter={(value) => (value == null ? '—' : `${value.toFixed(1)}%`)}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <ReferenceLine y={metaSemana} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Meta ${metaSemana}%`, fill: '#ef4444', fontSize: 9, position: 'top' }} />
                  {TURNO_KEYS.map((key) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={turnos?.[key]?.nome || key}
                      stroke={CORES_TURNO[key]}
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Pareto + MTTR/MTBF do dia */}
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2.5 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 size={13} className="text-amber-400" /> Top Motivos de Parada
              </h2>
              {pareto?.mttrSeg != null && (
                <span className="text-[10px] text-slate-400 font-mono">
                  MTTR: <strong className="text-amber-400">{formatDuracaoSeg(pareto.mttrSeg)}</strong>
                  {'  '}MTBF: <strong className="text-emerald-400">{formatDuracaoSeg(pareto.mtbfSeg)}</strong>
                </span>
              )}
            </div>
            {!pareto || pareto.porMotivo.length === 0 ? (
              <p className="text-slate-500 text-xs">Nenhuma parada classificada nesse dia.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(() => {
                  const maior = Math.max(...pareto.porMotivo.map((m) => m.totalSeg));
                  return pareto.porMotivo.slice(0, 5).map((m) => (
                    <div key={m.motivoId} className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-200">{m.nome} <span className="text-slate-500">({m.quantidade}x)</span></span>
                        <span className="text-slate-400 font-mono">{formatDuracaoSeg(m.totalSeg)}</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${m.tipo === 'programada' ? 'bg-sky-500' : 'bg-red-500'}`}
                          style={{ width: `${maior > 0 ? (m.totalSeg / maior) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>

          </div>
        </>
      )}
    </div>
  );
}
