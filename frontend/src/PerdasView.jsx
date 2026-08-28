import React, { useState, useEffect } from 'react';
import { Scale, RefreshCw, Package, AlertTriangle, TrendingUp, FileText, Download, X, CalendarDays } from 'lucide-react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import api, { isOk } from './api';

const TURNO_KEYS = ['turnoA', 'turnoB', 'turnoC'];
const ZERO_TURNO = { nome: null, isAtual: false, isFutura: false, variaveis: [], totalKg: 0, inicio: null, fimProgramado: null };
const CORES = ['#38bdf8', '#f59e0b', '#22c55e', '#a855f7', '#f472b6', '#2dd4bf', '#eab308', '#ef4444'];

// Data de hoje no fuso LOCAL do navegador (não UTC) — mesmo formato
// (YYYY-MM-DD) que o backend usa pra "prender" o turno no dia certo.
function hojeLocalStr() {
  return new Date().toLocaleDateString('sv-SE');
}

function formatKg(kg) {
  return `${Number(kg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg`;
}

// Ponto do gráfico de pesagens — o círculo visível fica pequeno (raio 3.5),
// mas o alvo que reage ao mouse é bem maior (raio 11, invisível) por baixo
// dele. Sem isso, o Tooltip do Recharts só aparece quando o cursor cai
// pixel-a-pixel em cima do pontinho, quase impossível de acertar no zoom
// normal — "aproximar" do ponto não bastava.
function pontoPerdaShape(props) {
  const { cx, cy, fill } = props;
  if (typeof cx !== 'number' || typeof cy !== 'number') return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle cx={cx} cy={cy} r={3.5} fill={fill} stroke="#0f172a" strokeWidth={1} />
    </g>
  );
}

// Tooltip customizado — o Recharts, pra um Scatter, manda o valor como par
// [x, y] em vez de um número só, então o formatter/labelFormatter padrão
// (feitos pra Line/Bar) não davam conta. Lê direto do ponto bruto (payload).
function PerdaTooltipContent({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const dado = entry.payload;
  return (
    <div style={{ backgroundColor: '#1e293b', border: '1px solid #475569', color: '#f1f5f9', borderRadius: 6, fontSize: 11, padding: '6px 10px' }}>
      <div style={{ color: '#94a3b8', marginBottom: 2 }}>
        {new Date(dado.tempoMs).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div style={{ color: entry.color || entry.fill, fontWeight: 700 }}>
        {entry.name}: {Number(dado.valorKg).toFixed(2)} kg
      </div>
    </div>
  );
}

function formatDataBR(dataStr) {
  if (!dataStr) return '';
  const [ano, mes, dia] = dataStr.split('-');
  return `${dia}/${mes}/${ano}`;
}

function exportarCsvPerdas(linhas, sufixoArquivo) {
  if (linhas.length === 0) return;
  const header = ['Data', 'Turno', 'Variável', 'Perda (kg)'].join(';');
  const corpo = linhas.map((l) => [formatDataBR(l.data), l.turnoNome, l.descricao, l.perdaKg.toFixed(2).replace('.', ',')].join(';'));
  const csv = `${header}\n${corpo.join('\n')}`;
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `perdas_${sufixoArquivo}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Modal do botão "Gerar Relatório" — período livre escolhido pelo usuário,
// baixa direto em CSV (mesmo padrão do relatório de Paradas).
function RelatorioPerdasModal({ onClose }) {
  const hojeStr = hojeLocalStr();
  const [dataInicial, setDataInicial] = useState(hojeStr);
  const [dataFinal, setDataFinal] = useState(hojeStr);
  const [gerando, setGerando] = useState(false);
  const [error, setError] = useState('');

  const handleGerar = async () => {
    if (!dataInicial || !dataFinal) { setError('Selecione as duas datas.'); return; }
    if (dataInicial > dataFinal) { setError('Data inicial não pode ser depois da data final.'); return; }
    setGerando(true);
    setError('');
    try {
      const res = await api.get('/api/perdas/relatorio', { params: { startDate: dataInicial, endDate: dataFinal } });
      if (isOk(res)) {
        if (res.data.length === 0) {
          setError('Nenhum turno já concluído nesse período (ainda não aconteceu, ou sem variáveis configuradas).');
        } else {
          const sufixo = dataInicial === dataFinal ? dataInicial : `${dataInicial}_a_${dataFinal}`;
          exportarCsvPerdas(res.data, sufixo);
          onClose();
        }
      } else {
        setError(res.data?.error || 'Erro ao gerar relatório.');
      }
    } catch (err) {
      setError('Erro ao gerar relatório.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-2xl w-full max-w-sm flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <FileText size={16} className="text-amber-400" /> Gerar Relatório de Perdas
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <p className="text-slate-400 text-xs">Escolha o período — sai em CSV, uma linha por turno/variável, pronto pra abrir no Excel.</p>

        {error && <p className="text-red-300 text-xs">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            De
            <input
              type="date"
              value={dataInicial}
              max={hojeStr}
              onChange={(e) => setDataInicial(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Até
            <input
              type="date"
              value={dataFinal}
              max={hojeStr}
              onChange={(e) => setDataFinal(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </label>
        </div>

        <button
          onClick={handleGerar}
          disabled={gerando}
          className="flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50 mt-1"
        >
          <Download size={14} /> {gerando ? 'Gerando…' : 'Baixar CSV'}
        </button>
      </div>
    </div>
  );
}

// Estatísticas e registros de Perdas — turnos em abas (igual OEE), totais
// acumulados em destaque nos cards, e um gráfico de dispersão mostrando cada
// PESAGEM individual gravada pelo operador (horário e peso reais do evento,
// sem acumular). Cada turno tem sua própria janela — ao virar de turno, o
// gráfico troca de conteúdo sozinho, sem precisar de reset manual.
export default function PerdasView({ onBack, isMuted }) {
  const hojeStr = hojeLocalStr();
  const [perdasConfig, setPerdasConfig] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [tendencia, setTendencia] = useState(null);
  const [selectedTurno, setSelectedTurno] = useState('turnoB');
  const [selectedData, setSelectedData] = useState(hojeStr);
  const [refreshInterval, setRefreshInterval] = useState(15000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRelatorio, setShowRelatorio] = useState(false);

  const verHoje = selectedData === hojeStr;

  const carregarConfig = () => {
    api.get('/api/config/perdas')
      .then((res) => { if (isOk(res)) setPerdasConfig((res.data || []).filter((p) => p.ativo)); })
      .catch(() => {});
  };

  const carregarMetrics = () => {
    api.get('/api/perdas/metrics', { params: { data: selectedData } })
      .then((res) => {
        if (isOk(res)) { setMetrics(res.data); setError(''); }
        else setError(res.data?.error || 'Erro ao carregar métricas de perdas.');
      })
      .catch(() => setError('Erro de conexão com o servidor.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { carregarConfig(); }, []);

  // Vendo um dia passado, os números não mudam mais — não faz sentido ficar
  // repetindo a consulta sozinho (só quando o usuário volta pra "hoje").
  useEffect(() => {
    carregarMetrics();
    if (refreshInterval <= 0 || !verHoje) return;
    const interval = setInterval(carregarMetrics, refreshInterval);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInterval, selectedData]);

  // Tendência (gráfico) — depende do turno e do dia selecionados, reconsulta no mesmo ritmo.
  useEffect(() => {
    let cancelado = false;
    const fetchTendencia = () => {
      api.get('/api/perdas/tendencia', { params: { turnoKey: selectedTurno, data: selectedData } })
        .then((res) => { if (!cancelado && isOk(res)) setTendencia(res.data); })
        .catch((err) => console.error('Erro ao buscar tendência de perdas:', err));
    };
    fetchTendencia();
    const interval = refreshInterval > 0 && verHoje ? setInterval(fetchTendencia, refreshInterval) : null;
    return () => { cancelado = true; if (interval) clearInterval(interval); };
  }, [selectedTurno, selectedData, refreshInterval, verHoje]);

  // Seleciona automaticamente o turno atual na primeira carga (só faz
  // sentido olhando o dia de hoje — em dias passados nenhum turno é "atual").
  useEffect(() => {
    if (!metrics || !verHoje) return;
    const atual = TURNO_KEYS.find((k) => metrics.turnos?.[k]?.isAtual);
    if (atual) setSelectedTurno(atual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!metrics, verHoje]);

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

        <div className="flex items-center gap-2 flex-wrap">
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

          <label className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded px-2 py-1">
            <CalendarDays size={13} className="text-amber-500 shrink-0" />
            <input
              type="date"
              value={selectedData}
              max={hojeStr}
              onChange={(e) => setSelectedData(e.target.value)}
              className="bg-transparent text-slate-200 text-xs focus:outline-none"
            />
          </label>

          <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1">
            <RefreshCw size={13} className={`text-amber-500 ${refreshInterval > 0 && verHoje ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              disabled={!verHoje}
              title={verHoje ? undefined : 'Atualização automática só se aplica ao dia de hoje'}
              className="bg-slate-900 text-slate-200 text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none disabled:opacity-50"
            >
              <option value={5000}>5s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={0}>Off</option>
            </select>
          </div>

          <button
            onClick={() => setShowRelatorio(true)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold px-3 py-1.5 rounded transition"
          >
            <FileText size={13} /> Relatório
          </button>
        </div>
      </div>

      {!verHoje && (
        <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs p-2 rounded">
          <CalendarDays size={14} className="shrink-0" /> Vendo dados de {formatDataBR(selectedData)} — atualização automática pausada.
        </div>
      )}
      {verHoje && turnoSelecionado.isFutura && (
        <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 text-slate-400 text-xs p-2 rounded">
          <AlertTriangle size={14} className="shrink-0" /> {turnoLabel(selectedTurno)} ainda não começou hoje — sem pesagens registradas ainda.
        </div>
      )}

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
              {/* ScatterChart (não ComposedChart) de propósito: só ele ativa o
                  Tooltip por hover DIRETO em cada ponto — ComposedChart usa
                  tracking por posição no eixo X (feito pra Line/Bar), que não
                  funciona pra pontos esparsos de um Scatter. */}
              <ScatterChart margin={{ top: 5, right: 15, left: 0, bottom: -5 }}>
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
                <Tooltip content={<PerdaTooltipContent />} cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {variaveisChart.map((v, idx) => (
                  <Scatter
                    key={v.fieldName}
                    data={v.leituras}
                    name={v.descricao}
                    fill={CORES[idx % CORES.length]}
                    line={{ stroke: CORES[idx % CORES.length], strokeOpacity: 0.35 }}
                    shape={pontoPerdaShape}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {showRelatorio && <RelatorioPerdasModal onClose={() => setShowRelatorio(false)} />}
    </div>
  );
}
