import React, { useState, useEffect } from 'react';
import { Gauge, Home, Activity, CheckCircle, Clock, Database, TrendingUp, TrendingDown, Settings } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';

export default function OeeView({ onBack, onOpenConfig, oeeData }) {
  const [historyData, setHistoryData] = useState([]);
  const [selectedTurno, setSelectedTurno] = useState('atual'); // 'atual' (Turno B), 'turnoA', 'turnoC'

  const runTimeSec = oeeData?.runTimeSec || 0;
  const totalCount = oeeData?.totalCount || 0;
  const goodCount = oeeData?.goodCount || 0;

  const plannedTimeSec = 28800;
  const idealCycleTimeSec = 20;

  // Carrega as configurações salvas no localStorage (ou usa os padrões de 80% de meta)
  const savedConfig = JSON.parse(localStorage.getItem('turnosConfig')) || {};
  const metaAtual = savedConfig[selectedTurno === 'atual' ? 'turnoB' : selectedTurno === 'turnoA' ? 'turnoA' : 'turnoC']?.metaOee || 80;

  // Cálculo do Turno Atual (Turno B)
  const availability = plannedTimeSec > 0 ? Math.min(100, (runTimeSec / plannedTimeSec) * 100) : 0;
  const performance = runTimeSec > 0 ? Math.min(100, ((idealCycleTimeSec * totalCount) / runTimeSec) * 100) : 0;
  const quality = totalCount > 0 ? Math.min(100, (goodCount / totalCount) * 100) : 100;
  const oeeAtual = (availability * performance * quality) / 10000;

  const turnosHistoricos = {
    atual: { availability, performance, quality, oee: oeeAtual, label: 'Turno Atual (B)' },
    turnoA: { availability: 78.0, performance: 85.0, quality: 95.0, oee: 74.5, label: 'Turno A' },
    turnoC: { availability: 88.5, performance: 91.0, quality: 97.0, oee: 82.8, label: 'Turno C' }
  };

  const currentMetrics = turnosHistoricos[selectedTurno];

  const getOeeColor = (val, meta) => {
    if (val < meta - 20) return '#ef4444';
    if (val < meta) return '#eab308';
    return '#22c55e';
  };

  useEffect(() => {
    const mock = [];
    const now = new Date();
    for (let i = 15; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 30 * 60000);
      const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const variation = Math.max(30, Math.min(100, currentMetrics.oee + (Math.sin(i) * 6)));
      mock.push({ time: timeStr, oee: Number(variation.toFixed(1)) });
    }
    setHistoryData(mock);
  }, [currentMetrics.oee]);

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

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-100 p-4 flex flex-col justify-between overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
          >
            <Home size={16} /> Início
          </button>
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Gauge size={22} /> Relatório de OEE por Turno (Meta: {metaAtual}%)
            </h1>
            <p className="text-slate-400 text-xs">Monitoramento gerencial e tendência da linha de produção</p>
          </div>
        </div>

        {/* Grupo Central: Seletor de Turnos + Botão de Configuração */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 p-1 rounded-lg">
            <span className="text-slate-400 text-xs px-2 font-semibold">TURNO:</span>
            <button
              onClick={() => setSelectedTurno('turnoA')}
              className={`px-3 py-1 rounded text-xs font-bold transition ${
                selectedTurno === 'turnoA' ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              Turno A
            </button>
            <button
              onClick={() => setSelectedTurno('atual')}
              className={`px-3 py-1 rounded text-xs font-bold transition ${
                selectedTurno === 'atual' ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              Atual (B)
            </button>
            <button
              onClick={() => setSelectedTurno('turnoC')}
              className={`px-3 py-1 rounded text-xs font-bold transition ${
                selectedTurno === 'turnoC' ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              Turno C
            </button>
          </div>

          <button
            onClick={onOpenConfig}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
            title="Configurar Horários e Metas"
          >
            <Settings size={16} /> Configurar
          </button>
        </div>

        {/* Variáveis Brutas PLC */}
        <div className="flex items-center gap-3 text-xs font-mono bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg shadow">
          <span className="text-amber-400 flex items-center gap-1 font-semibold"><Database size={13} /> PLC:</span>
          <span className="text-slate-300">RUN: <strong className="text-blue-400">{runTimeSec}s</strong></span>
          <span className="text-slate-300">TOT: <strong className="text-amber-400">{totalCount}</strong></span>
          <span className="text-slate-300">BOAS: <strong className="text-emerald-400">{goodCount}</strong></span>
        </div>
      </div>

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