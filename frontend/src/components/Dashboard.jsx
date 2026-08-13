import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Plus, LogOut, Settings, RefreshCw } from 'lucide-react';

const API_BASE = `http://${window.location.hostname}:5000/api`;

export default function Dashboard({ user, onLogout }) {
  const [widgets, setWidgets] = useState([
    { id: 1, field: 'temperatura_zona1', name: 'Temp. Zona 1 - Forno', color: '#ef4444', unit: '°C', desc: 'Zona inicial de assamento' },
    { id: 2, field: 'pressao_gas', name: 'Pressão da Linha de Gás', color: '#3b82f6', unit: 'Bar', desc: 'Pressão de alimentação dos queimadores' }
  ]);

  const [dataMap, setDataMap] = useState({});

  // Busca dados do InfluxDB
  const fetchMetricData = async (field) => {
    try {
      const res = await axios.get(`${API_BASE}/influx/metric?field=${field}&timeRange=-30m`);
      setDataMap(prev => ({ ...prev, [field]: res.data }));
    } catch (err) {
      console.error(`Erro ao carregar variável ${field}`, err);
    }
  };

  useEffect(() => {
    widgets.forEach(w => fetchMetricData(w.field));
    const interval = setInterval(() => {
      widgets.forEach(w => fetchMetricData(w.field));
    }, 10000); // Atualiza a cada 10s
    return () => clearInterval(interval);
  }, [widgets]);

  const addWidget = () => {
    const varName = prompt("Digite o nome da variável no InfluxDB (ex: temperatura_zona2, velocidade_esteira):");
    if (!varName) return;
    const newWidget = {
      id: Date.now(),
      field: varName,
      name: `Variável: ${varName}`,
      color: '#10b981',
      unit: 'Un',
      desc: 'Variável configurada pelo usuário'
    };
    setWidgets([...widgets, newWidget]);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <header className="flex justify-between items-center bg-slate-800 p-4 rounded-xl shadow-lg mb-6 border border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-amber-500">Monitoramento - Forno de Bolachas</h1>
          <p className="text-sm text-slate-400">Usuário: <span className="text-slate-200 font-semibold">{user.username}</span> ({user.role})</p>
        </div>
        <div className="flex gap-3">
          <button onClick={addWidget} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg font-medium transition">
            <Plus size={18} /> Add Gráfico
          </button>
          <button onClick={onLogout} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg font-medium transition">
            <LogOut size={18} /> Sair
          </button>
        </div>
      </header>

      {/* Grid de Gráficos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {widgets.map((widget) => (
          <div key={widget.id} className="bg-slate-800 border border-slate-700 p-5 rounded-xl shadow-lg">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-lg font-bold text-slate-100">{widget.name}</h3>
                <p className="text-xs text-slate-400">{widget.desc}</p>
              </div>
              <span className="text-xs bg-slate-700 px-2 py-1 rounded text-amber-400 font-mono">
                {widget.field}
              </span>
            </div>

            <div className="h-64 w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dataMap[widget.field] || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" unit={` ${widget.unit}`} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }} />
                  <Line type="monotone" dataKey="value" stroke={widget.color} strokeWidth={2.5} dot={false} name={widget.name} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}