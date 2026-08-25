import React, { useState, useEffect } from 'react';
import { Gauge, Activity, CheckCircle, Clock, Database, TrendingUp, TrendingDown, Settings, RotateCcw, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import api, { isOk } from './api';

const TURNO_KEYS = ['turnoA', 'turnoB', 'turnoC'];

const ZERO_TURNO = {
  nome: null, metaOee: 80, isAtual: false, plannedSeg: 0,
  runTimeSec: 0, totalCount: 0, refugoCount: 0, goodCount: 0,
  maquinaRodando: null, velocidadeInstantaneaPpm: null
};

// Mesma fórmula usada pro turno atual (ver mais abaixo), aplicada a um ponto
// do histórico — mantém os dois cálculos sempre iguais, um só lugar de verdade.
function calcularOeePonto(ponto, velocidadeNominalPpm) {
  const availability = ponto.plannedSeg > 0 ? Math.min(100, (ponto.runTimeSec / ponto.plannedSeg) * 100) : 0;
  const velocidadeReaMediaPpm = ponto.runTimeSec > 0 ? (ponto.totalCount / (ponto.runTimeSec / 60)) : 0;
  const performance = velocidadeNominalPpm > 0 ? Math.min(100, (velocidadeReaMediaPpm / velocidadeNominalPpm) * 100) : 0;
  const quality = ponto.totalCount > 0 ? Math.min(100, (ponto.goodCount / ponto.totalCount) * 100) : 100;
  return Number(((availability * performance * quality) / 10000).toFixed(1));
}

export default function OeeView({ onBack, onOpenConfig, oeeData, canConfig, onRefreshOee, refreshInterval, onRefreshIntervalChange }) {
  const [historyData, setHistoryData] = useState([]);
  const [selectedTurno, setSelectedTurno] = useState('turnoB');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  const isOeeConfigured = !!oeeData?.configured;
  const velocidadeNominalPpm = oeeData?.velocidadeNominalPpm || 50;
  const turnos = oeeData?.turnos || {};

  // Assim que os dados dos turnos chegam pela primeira vez, seleciona
  // automaticamente o que estiver rodando agora (isAtual) — só troca a
  // seleção sozinha nessa primeira vez, pra não tirar o usuário da aba que
  // ele escolheu olhar manualmente depois.
  useEffect(() => {
    const atual = TURNO_KEYS.find((k) => turnos[k]?.isAtual);
    if (atual) setSelectedTurno(atual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(turnos).length]);

  const turnoSelecionado = turnos[selectedTurno] || ZERO_TURNO;
  const metaAtual = turnoSelecionado.metaOee || 80;

  const runTimeSec = turnoSelecionado.runTimeSec || 0;
  const totalCount = turnoSelecionado.totalCount || 0;
  const refugoCount = turnoSelecionado.refugoCount || 0;
  const goodCount = turnoSelecionado.goodCount || 0;
  const plannedTimeSec = turnoSelecionado.plannedSeg || 28800;
  const velocidadeInstantaneaPpm = turnoSelecionado.velocidadeInstantaneaPpm;

  // Cálculo do turno selecionado
  const availability = plannedTimeSec > 0 ? Math.min(100, (runTimeSec / plannedTimeSec) * 100) : 0;
  // Performance em pacotes/minuto: velocidade real média (contagem total
  // dividida pelo tempo rodando, não pelo tempo total do turno — isola a
  // perda de velocidade da perda de disponibilidade, que já é contada à
  // parte) sobre a velocidade nominal da linha.
  const velocidadeReaMediaPpm = runTimeSec > 0 ? (totalCount / (runTimeSec / 60)) : 0;
  const performance = velocidadeNominalPpm > 0 ? Math.min(100, (velocidadeReaMediaPpm / velocidadeNominalPpm) * 100) : 0;
  const quality = totalCount > 0 ? Math.min(100, (goodCount / totalCount) * 100) : 100;
  const oeeAtual = (availability * performance * quality) / 10000;

  const turnoLabel = (key) => {
    const t = turnos[key];
    if (!t?.nome) return key === 'turnoA' ? 'Turno A' : key === 'turnoB' ? 'Turno B' : 'Turno C';
    return t.isAtual ? `${t.nome} (Atual)` : t.nome;
  };

  const currentMetrics = {
    availability, performance, quality, oee: oeeAtual,
    label: turnoLabel(selectedTurno)
  };

  const getOeeColor = (val, meta) => {
    if (val < meta - 20) return '#ef4444';
    if (val < meta) return '#eab308';
    return '#22c55e';
  };

  // Gráfico de tendência real: as últimas ocorrências do turno selecionado
  // (normalmente uma por dia), calculadas com os mesmos dados brutos e a
  // mesma fórmula do turno atual — não é mais simulado.
  useEffect(() => {
    let cancelado = false;
    api.get('/api/oee/historico', { params: { turnoKey: selectedTurno, quantidade: 14 } })
      .then((res) => {
        if (cancelado || !isOk(res)) return;
        const pontos = (res.data?.pontos || []).map((p) => ({
          time: p.label,
          oee: calcularOeePonto(p, res.data.velocidadeNominalPpm || velocidadeNominalPpm)
        }));
        setHistoryData(pontos);
      })
      .catch((err) => console.error('Erro ao buscar histórico do OEE:', err));
    return () => { cancelado = true; };
  }, [selectedTurno, velocidadeNominalPpm]);

  const ultimaMedia = historyData.length > 0 ? historyData[historyData.length - 1].oee : currentMetrics.oee;
  const estaNaMeta = ultimaMedia >= metaAtual;

  const r1 = 85;
  const c1 = 2 * Math.PI * r1;
  const stroke1 = c1 - (currentMetrics.availability / 100) * c1;

  const r2 = 68;
  const c2 = 2 * Math.PI * r2;
  const stroke2 = c2 - (currentMetrics.performance / 100) * c2;

  const r3 = 51;
  const c3 = 2 * Math.PI * r3;
  const stroke3 = c3 - (currentMetrics.quality / 100) * c3;

  const handleReset = async () => {
    if (!window.confirm('Zerar os contadores do OEE a partir de agora? Isso não muda nada no CLP — só marca este instante como novo ponto de partida pros cálculos.')) return;
    setResetting(true);
    setResetError('');
    try {
      const res = await api.post('/api/oee/reset');
      if (isOk(res)) {
        if (onRefreshOee) await onRefreshOee();
      } else {
        setResetError(res.data?.error || 'Erro ao zerar: sem permissão ou sessão expirada.');
      }
    } catch (err) {
      setResetError('Erro ao zerar contadores do OEE.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-4 flex flex-col justify-between overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Gauge size={22} /> Relatório de OEE por Turno (Meta: {metaAtual}%)
            </h1>
            <p className="text-slate-400 text-xs">Monitoramento gerencial e tendência da linha de produção</p>
          </div>
        </div>

        {/* Grupo Central: Seletor de Turnos + Botões */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 p-1 rounded-lg">
            <span className="text-slate-400 text-xs px-2 font-semibold">TURNO:</span>
            {TURNO_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedTurno(key)}
                className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                  selectedTurno === key ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                {turnos[key]?.isAtual && (
                  <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" title="Rodando agora" />
                )}
                {turnos[key]?.nome || (key === 'turnoA' ? 'Turno A' : key === 'turnoB' ? 'Turno B' : 'Turno C')}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1">
            <RefreshCw size={14} className={`text-amber-500 ${refreshInterval > 0 ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            <select
              value={refreshInterval}
              onChange={(e) => onRefreshIntervalChange?.(Number(e.target.value))}
              className="bg-slate-900 text-slate-200 text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none"
              title="Frequência de atualização automática"
            >
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={0}>Off</option>
            </select>
          </div>

          {canConfig && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-red-900/60 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow disabled:opacity-50"
              title="Zerar os contadores do OEE a partir de agora"
            >
              <RotateCcw size={14} /> {resetting ? 'Zerando…' : 'Zerar'}
            </button>
          )}

          {canConfig && (
            <button
              onClick={onOpenConfig}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
              title="Configurar Horários e Metas"
            >
              <Settings size={16} /> Configurar
            </button>
          )}
        </div>

        {/* Variáveis Brutas PLC */}
        <div className="flex items-center gap-3 text-xs font-mono bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg shadow">
          <span className="text-amber-400 flex items-center gap-1 font-semibold"><Database size={13} /> PLC:</span>
          <span className="text-slate-300">RUN: <strong className="text-blue-400">{runTimeSec}s</strong></span>
          <span className="text-slate-300">TOT: <strong className="text-amber-400">{totalCount}</strong></span>
          <span className="text-slate-300">BOAS: <strong className="text-emerald-400">{goodCount}</strong></span>
          <span className="text-slate-300">REFUGO: <strong className="text-red-400">{refugoCount}</strong></span>
          {velocidadeInstantaneaPpm != null && (
            <span className="text-slate-300">
              VELOCIDADE: <strong className="text-sky-400">{velocidadeInstantaneaPpm.toFixed(0)} pct/min</strong>
            </span>
          )}
          <span className="text-slate-300">
            NOMINAL: <strong className="text-violet-400">{velocidadeNominalPpm} pct/min</strong>
          </span>
        </div>
      </div>

      {resetError && (
        <div className="bg-red-950/40 border border-red-700 text-red-200 text-xs rounded-lg px-4 py-2.5">
          {resetError}
        </div>
      )}

      {!isOeeConfigured && (
        <div className="bg-amber-950/40 border border-amber-700 text-amber-200 text-xs rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <span>
            O cálculo do OEE ainda não está ligado a nenhuma variável real — os números abaixo estão zerados.
            {canConfig ? ' Configure o mapeamento das variáveis em "Configurar".' : ' Peça pra um supervisor/administrador configurar em "Configurar".'}
          </span>
          {canConfig && (
            <button
              onClick={onOpenConfig}
              className="shrink-0 flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition"
            >
              <Settings size={14} /> Configurar agora
            </button>
          )}
        </div>
      )}

      {isOeeConfigured && TURNO_KEYS.every((k) => !turnos[k]) && (
        <div className="bg-amber-950/40 border border-amber-700 text-amber-200 text-xs rounded-lg px-4 py-2.5">
          Nenhum turno foi salvo ainda em "Configurar" → Parâmetros Operacionais por Turno — sem isso, não dá pra saber
          o horário/duração de cada turno pra calcular a Disponibilidade.
        </div>
      )}

      {/* Seção Central */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 my-auto">

        {/* Coluna Esquerda: Cards de Métricas */}
        <div className="lg:col-span-4 flex flex-col justify-between gap-3">
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase">Disponibilidade ({currentMetrics.label})</span>
              <h2 className="text-2xl font-bold text-emerald-400 font-mono mt-0.5">{currentMetrics.availability.toFixed(1)}%</h2>
            </div>
            <Activity className="text-emerald-400 bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/20" size={36} />
          </div>

          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase">Performance ({currentMetrics.label})</span>
              <h2 className="text-2xl font-bold text-amber-400 font-mono mt-0.5">{currentMetrics.performance.toFixed(1)}%</h2>
              {turnoSelecionado.isAtual && velocidadeInstantaneaPpm != null && (
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  Agora: <span className="text-sky-400 font-bold">{velocidadeInstantaneaPpm.toFixed(0)}</span> de {velocidadeNominalPpm} pct/min
                </p>
              )}
            </div>
            <Clock className="text-amber-400 bg-amber-950/40 p-2 rounded-lg border border-amber-500/20" size={36} />
          </div>

          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase">Qualidade ({currentMetrics.label})</span>
              <h2 className="text-2xl font-bold text-orange-400 font-mono mt-0.5">{currentMetrics.quality.toFixed(1)}%</h2>
            </div>
            <CheckCircle className="text-orange-400 bg-orange-950/40 p-2 rounded-lg border border-orange-500/20" size={36} />
          </div>
        </div>

        {/* Coluna Direita: OEE Consolidado */}
        <div className="lg:col-span-8 bg-slate-800/90 border border-slate-700 rounded-xl p-5 shadow-md flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              OEE Consolidado — {currentMetrics.label}
            </h3>

            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
              estaNaMeta ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/40' : 'bg-red-950/60 text-red-400 border-red-500/40'
            }`}>
              {estaNaMeta ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {estaNaMeta ? `Tendência: Dentro da Meta (≥ ${metaAtual}%)` : `Tendência: Fora da Meta (< ${metaAtual}%)`}
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-700/80 px-8 py-4 rounded-xl shadow-inner flex items-center justify-center">
            <div className="relative w-52 h-52 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r={r1} fill="none" stroke="#1e293b" strokeWidth="13" />
                <circle cx="100" cy="100" r={r1} fill="none" stroke="#22c55e" strokeWidth="13"
                  strokeDasharray={c1} strokeDashoffset={stroke1} strokeLinecap="round" className="transition-all duration-700" />

                <circle cx="100" cy="100" r={r2} fill="none" stroke="#1e293b" strokeWidth="13" />
                <circle cx="100" cy="100" r={r2} fill="none" stroke="#eab308" strokeWidth="13"
                  strokeDasharray={c2} strokeDashoffset={stroke2} strokeLinecap="round" className="transition-all duration-700" />

                <circle cx="100" cy="100" r={r3} fill="none" stroke="#1e293b" strokeWidth="13" />
                <circle cx="100" cy="100" r={r3} fill="none" stroke="#f97316" strokeWidth="13"
                  strokeDasharray={c3} strokeDashoffset={stroke3} strokeLinecap="round" className="transition-all duration-700" />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-5xl font-extrabold font-mono tracking-tight" style={{ color: getOeeColor(currentMetrics.oee, metaAtual) }}>
                  {currentMetrics.oee.toFixed(0)}%
                </span>
                <span className="text-[11px] text-slate-400 font-bold tracking-widest uppercase mt-1">OEE Global</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Gráfico de Tendência */}
      <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3.5 shadow-md">
        <div className="flex justify-between items-center mb-1.5">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp size={15} className="text-amber-400" /> Gráfico de Tendência do OEE ({currentMetrics.label}) - Meta: {metaAtual}%
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">Atual: <strong className="text-amber-400">{currentMetrics.oee.toFixed(1)}%</strong></span>
        </div>

        <div style={{ width: '100%', height: '145px' }} className="bg-slate-900/70 p-2 rounded-lg border border-slate-700/60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData} margin={{ top: 5, right: 15, left: -20, bottom: -5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9', borderRadius: '6px', fontSize: '11px' }}
                itemStyle={{ color: '#38bdf8' }}
              />
              <ReferenceLine y={metaAtual} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Meta ${metaAtual}%`, fill: '#ef4444', fontSize: 10, position: 'top' }} />

              <Line type="monotone" dataKey="oee" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3, fill: '#38bdf8' }} activeDot={{ r: 5 }} name="Tendência OEE (%)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
