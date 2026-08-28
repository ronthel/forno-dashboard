import React, { useState, useEffect, useMemo } from 'react';
import { Scale, RefreshCw, Package, AlertTriangle, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import api, { isOk } from './api';

const TURNO_KEYS = ['turnoA', 'turnoB', 'turnoC'];
const ZERO_TURNO = { nome: null, isAtual: false, variaveis: [], totalKg: 0, inicio: null, fimProgramado: null };
const CORES = ['#38bdf8', '#f59e0b', '#22c55e', '#a855f7', '#f472b6', '#2dd4bf', '#eab308', '#ef4444'];

function formatKg(kg) {
  return `${Number(kg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg`;
}

// Estatísticas e registros de Perdas — turnos em abas (igual OEE), totais
// acumulados em destaque nos cards, e um gráfico de dispersão mostrando cada
// PESAGEM individual gravada pelo operador (horário e peso reais do evento,
// sem acumular). Cada turno tem sua própria janela — ao virar de turno, o
// gráfico troca de conteúdo sozinho, sem precisar de reset manual.
export default function PerdasView({ onBack, isMuted }) {
  const [perdasConfig, setPerdasConfig] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [tendencia, setTendencia] = useState(null);
  const [selectedTurno, setSelectedTurno] = useState('turnoB');
  const [refreshInterval, setRefreshInterval] = useState(15000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const carregarConfig = () => {
    api.get('/api/config/perdas')
      .then((res) => { if (isOk(res)) setPerdasConfig((res.data || []).filter((p) => p.ativo)); })
      .catch(() => {});
  };

  const carregarMetrics = () => {
    api.get('/api/perdas/metrics')
      .then((res) => {
        if (isOk(res)) { setMetrics(res.data); setError(''); }
        else setError(res.data?.error || 'Erro ao carregar métricas de perdas.');
      })
      .catch(() => setError('Erro de conexão com o servidor.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { carregarConfig(); }, []);

  useEffect(() => {
    carregarMetrics();
    if (refreshInterval <= 0) return;
    const interval = setInterval(carregarMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  // Tendência (gráfico) — depende do turno selecionado, reconsulta no mesmo ritmo.
  useEffect(() => {
    let cancelado = false;
    const fetchTendencia = () => {
      api.get('/api/perdas/tendencia', { params: { turnoKey: selectedTurno } })
        .then((res) => { if (!cancelado && isOk(res)) setTendencia(res.data); })
        .catch((err) => console.error('Erro ao buscar tendência de perdas:', err));
    };
    fetchTendencia();
    const interval = refreshInterval > 0 ? setInterval(fetchTendencia, refreshInterval) : null;
    return () => { cancelado = true; if (interval) clearInterval(interval); };
  }, [selectedTurno, refreshInterval]);

  // Seleciona automaticamente o turno atual na primeira carga.
  useEffect(() => {
    if (!metrics) return;
    const atual = TURNO_KEYS.find((k) => metrics.turnos?.[k]?.isAtual);
    if (atual) setSelectedTurno(atual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!metrics]);

  const turnos = metrics?.turnos || {};
  const turnoSelecionado = turnos[selectedTurno] || ZERO_TURNO;
  const configured = !!metrics?.configured;

  const turnoLabel = (key) => {
    const t = turnos[key];
    if (!t?.nome) return key === 'turnoA' ? 'Turno A' : key === 'turnoB' ? 'Turno B' : 'Turno C';
    return t.isAtual ? `${t.nome} (Atual)` : t.nome;
  };

  const variaveisChart = tendencia?.variaveis || [];
  const xDomain = tendencia?.inicio && tendencia?.fimProgramado
    ? [new Date(tendencia.inicio).getTime(), new Date(tendencia.fimProgramado).getTime()]
    : ['dataMin', 'dataMax'];

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-4 flex flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-800 pb-2.5">
        <div>
          <h1 className="text-lg font-bold text-amber-500 flex items-center gap-2">
            <Scale size={20} /> Estatísticas de Perdas
          </h1>
          <p className="text-slate-400 text-xs">Perda acumulada por turno, em kg, das variáveis vinculadas</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 p-1 rounded-lg">
            {TURNO_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedTurno(key)}
                className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                  selectedTurno === key ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                {turnos[key]?.isAtual && <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" title="Turno atual" />}
                {turnoLabel(key)}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1">
            <RefreshCw size={13} className={`text-amber-500 ${refreshInterval > 0 ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-slate-900 text-slate-200 text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none"
            >
              <option value={5000}>5s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={0}>Off</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-2.5 rounded">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {!loading && !configured && (
        <div className="bg-amber-950/40 border border-amber-700 text-amber-200 text-xs rounded-lg px-3 py-2">
          Nenhuma variável vinculada às Perdas ainda — os números abaixo ficam zerados até configurar em "Parâmetros Perdas".
        </div>
      )}

      {/* Total do turno selecionado + soma geral */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md">
          <span className="text-slate-400 text-[11px] font-semibold uppercase">Perda por variável — {turnoLabel(selectedTurno)}</span>
          {turnoSelecionado.variaveis.length === 0 ? (
            <p className="text-slate-500 text-xs mt-2">Sem variáveis configuradas.</p>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              {turnoSelecionado.variaveis.map((v) => (
                <div key={v.fieldName} className="flex items-center justify-between text-xs bg-slate-900/60 rounded-lg px-3 py-1.5">
                  <span className="text-slate-200">{v.descricao}</span>
                  <span className="text-red-400 font-mono font-bold">{formatKg(v.perdaKg)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-slate-800/90 border border-red-700/50 rounded-xl p-3 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[10px] font-semibold uppercase block">Total — {turnoLabel(selectedTurno)}</span>
              <span className="text-2xl font-extrabold font-mono text-red-400">{formatKg(turnoSelecionado.totalKg)}</span>
            </div>
            <Package className="text-red-400 bg-red-950/40 p-2 rounded-lg border border-red-500/20" size={30} />
          </div>
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[10px] font-semibold uppercase block">Total Geral (3 turnos)</span>
              <span className="text-xl font-extrabold font-mono text-amber-400">{formatKg(metrics?.totalGeralKg)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Gráfico de pesagens — cada ponto é UM registro gravado pelo operador
          (horário e peso reais do evento), sem somar nada. */}
      {perdasConfig.length > 0 && (
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md flex-1 min-h-[320px] flex flex-col">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <TrendingUp size={14} className="text-amber-400" /> Pesagens Registradas — {turnoLabel(selectedTurno)}
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 5, right: 15, left: 0, bottom: -5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="tempoMs"
                  type="number"
                  scale="time"
                  domain={xDomain}
                  tickFormatter={(ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  stroke="#94a3b8" tick={{ fontSize: 10 }}
                />
                <YAxis
                  dataKey="valorKg"
                  stroke="#94a3b8" tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v} kg`}
                />
                <Tooltip
                  labelFormatter={(ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  formatter={(value) => `${Number(value).toFixed(2)} kg`}
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9', borderRadius: '6px', fontSize: '11px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {variaveisChart.map((v, idx) => (
                  <Scatter
                    key={v.fieldName}
                    data={v.leituras}
                    name={v.descricao}
                    fill={CORES[idx % CORES.length]}
                    line={{ stroke: CORES[idx % CORES.length], strokeOpacity: 0.35 }}
                    shape="circle"
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
