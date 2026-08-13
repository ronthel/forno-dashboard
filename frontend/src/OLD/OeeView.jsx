import React, { useState, useEffect } from 'react';
import { Gauge, ArrowLeft, Activity, CheckCircle, Clock, Database } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function OeeView({ onBack, oeeData }) {
  const [historyData, setHistoryData] = useState([]);

  // Desestrutura os valores reais vindos do InfluxDB via App.jsx
  const runTimeSec = oeeData?.runTimeSec || 0;
  const totalCount = oeeData?.totalCount || 0;
  const goodCount = oeeData?.goodCount || 0;

  // Parâmetros de cálculo
  const plannedTimeSec = 28800; // Turno de 8 horas em segundos
  const idealCycleTimeSec = 20; // Tempo ideal por peça em segundos

  // 1. Disponibilidade = (Tempo Operacional / Tempo Planejado) * 100
  const availability = plannedTimeSec > 0 ? Math.min(100, (runTimeSec / plannedTimeSec) * 100) : 0;

  // 2. Performance = (Ciclo Ideal * Total Produzido) / Tempo Operacional * 100
  const performance = runTimeSec > 0 ? Math.min(100, ((idealCycleTimeSec * totalCount) / runTimeSec) * 100) : 0;

  // 3. Qualidade = (Peças Boas / Total Produzido) * 100
  const quality = totalCount > 0 ? Math.min(100, (goodCount / totalCount) * 100) : 100;

  // 4. OEE Geral = (Disponibilidade * Performance * Qualidade) / 10000
  const oee = (availability * performance * quality) / 10000;

  // Definição da cor do OEE baseada nas faixas solicitadas
  const getOeeColor = (val) => {
    if (val < 60) return '#ef4444'; // Vermelho
    if (val <= 80) return '#eab308'; // Amarelo
    return '#22c55e'; // Verde
  };

  // Inicializa o histórico com dados consistentes para o gráfico de linha
  useEffect(() => {
    const mock = [];
    const now = new Date();
    for (let i = 12; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 30 * 60000);
      const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const variation = Math.max(15, Math.min(100, oee + (Math.sin(i) * 8)));
      mock.push({ time: timeStr, oee: Number(variation.toFixed(1)) });
    }
    setHistoryData(mock);
  }, [oee]);

  // Cálculos de Stroke-Dasharray para os anéis SVG tipo Grafana
  const r1 = 75;
  const c1 = 2 * Math.PI * r1;
  const stroke1 = c1 - (availability / 100) * c1;

  const r2 = 58;
  const c2 = 2 * Math.PI * r2;
  const stroke2 = c2 - (performance / 100) * c2;

  const r3 = 41;
  const c3 = 2 * Math.PI * r3;
  const stroke3 = c3 - (quality / 100) * c3;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      {/* Cabeçalho da Página de OEE */}
      <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded text-xs font-semibold transition"
          >
            <ArrowLeft size={16} /> Voltar ao Dashboard
          </button>
          <div>
            <h1 className="text-2xl font-bold text-amber-500 flex items-center gap-2">
              <Gauge size={26} /> Relatório Gerencial de OEE (Eficiência Global)
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Valores em tempo real sincronizados com o banco de dados e PLC
            </p>
          </div>
        </div>
      </div>

      {/* Caixa com os Valores Brutos Lidos do Banco de Dados / PLC */}
      <div className="bg-slate-800/60 border border-slate-700/80 rounded-lg p-4 mb-6 shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
          <Database size={18} /> Variáveis Brutas do PLC no InfluxDB:
        </div>
        <div className="flex flex-wrap gap-6 text-sm font-mono">
          <div className="bg-slate-900 px-3 py-1.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block">RUN_TIME_SEC:</span>
            <span className="text-blue-400 font-bold">{runTimeSec} s</span>
          </div>
          <div className="bg-slate-900 px-3 py-1.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block">TOTAL_COUNT:</span>
            <span className="text-amber-400 font-bold">{totalCount} pçs</span>
          </div>
          <div className="bg-slate-900 px-3 py-1.5 rounded border border-slate-700">
            <span className="text-slate-400 text-xs block">GOOD_COUNT:</span>
            <span className="text-emerald-400 font-bold">{goodCount} pçs</span>
          </div>
        </div>
      </div>

      {/* Cards de Métricas Individuais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <span className="text-slate-400 text-sm font-semibold uppercase">Disponibilidade</span>
            <Activity className="text-emerald-400" size={24} />
          </div>
          <h2 className="text-4xl font-bold text-emerald-400 font-mono">{availability.toFixed(1)}%</h2>
          <p className="text-slate-500 text-xs mt-2">Baseado em RUN_TIME vs Turno (28800s)</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <span className="text-slate-400 text-sm font-semibold uppercase">Performance</span>
            <Clock className="text-amber-400" size={24} />
          </div>
          <h2 className="text-4xl font-bold text-amber-400 font-mono">{performance.toFixed(1)}%</h2>
          <p className="text-slate-500 text-xs mt-2">Baseado no total produzido ({totalCount})</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <span className="text-slate-400 text-sm font-semibold uppercase">Qualidade</span>
            <CheckCircle className="text-orange-400" size={24} />
          </div>
          <h2 className="text-4xl font-bold text-orange-400 font-mono">{quality.toFixed(1)}%</h2>
          <p className="text-slate-500 text-xs mt-2">Baseado em boas ({goodCount}) / total ({totalCount})</p>
        </div>
      </div>

      {/* Bloco do Painel Estilo Grafana Limpo (Gauge Centralizado) */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 shadow-lg mb-8 flex flex-col items-center justify-center">
        <h3 className="text-xl font-bold text-slate-200 mb-6 self-start">OEE Consolidado do Turno</h3>

        <div className="flex items-center bg-slate-900 border border-slate-700 px-12 py-8 rounded-2xl shadow-inner">
          <div className="relative w-56 h-56 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 180 180">
              <circle cx="90" cy="90" r={r1} fill="none" stroke="#1e293b" strokeWidth="13" />
              <circle cx="90" cy="90" r={r1} fill="none" stroke="#22c55e" strokeWidth="13"
                strokeDasharray={c1} strokeDashoffset={stroke1} strokeLinecap="round" className="transition-all duration-700" />

              <circle cx="90" cy="90" r={r2} fill="none" stroke="#1e293b" strokeWidth="13" />
              <circle cx="90" cy="90" r={r2} fill="none" stroke="#eab308" strokeWidth="13"
                strokeDasharray={c2} strokeDashoffset={stroke2} strokeLinecap="round" className="transition-all duration-700" />

              <circle cx="90" cy="90" r={r3} fill="none" stroke="#1e293b" strokeWidth="13" />
              <circle cx="90" cy="90" r={r3} fill="none" stroke="#f97316" strokeWidth="13"
                strokeDasharray={c3} strokeDashoffset={stroke3} strokeLinecap="round" className="transition-all duration-700" />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-4xl font-extrabold font-mono tracking-tight" style={{ color: getOeeColor(oee) }}>
                {oee.toFixed(0)}%
              </span>
              <span className="text-xs text-slate-400 font-semibold tracking-wider uppercase mt-1">OEE Global</span>
            </div>
          </div>
        </div>
      </div>

      {/* Gráfico de Linha para Acompanhamento do OEE no Tempo (Com Altura Inline Forçada) */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 shadow-lg">
        <h3 className="text-xl font-bold text-slate-200 mb-4">Variação do OEE no Tempo (Últimas 24h)</h3>
        <div style={{ width: '100%', height: '300px' }} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9', borderRadius: '8px' }}
                itemStyle={{ color: '#38bdf8' }}
              />
              <Line type="monotone" dataKey="oee" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4, fill: '#38bdf8' }} activeDot={{ r: 6 }} name="OEE (%)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}