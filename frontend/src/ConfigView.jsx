import React, { useState, useEffect } from 'react';
import api, { isOk } from './api';
import { Home, Save, Settings, Clock, Target, Check } from 'lucide-react';

export default function ConfigView({ onBack }) {
  const [turnosConfig, setTurnosConfig] = useState({
    turnoA: { nome: 'Turno A', inicio: '06:00', fim: '14:00', metaOee: 80 },
    turnoB: { nome: 'Turno B (Atual)', inicio: '14:00', fim: '22:00', metaOee: 80 },
    turnoC: { nome: 'Turno C', inicio: '22:00', fim: '06:00', metaOee: 80 },
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  // Carregar do PostgreSQL ao abrir
  useEffect(() => {
    api.get('/api/config/turnos')
      .then((res) => res.data)
      .then((data) => {
        if (data && Object.keys(data).length > 0) {
          setTurnosConfig(data);
        }
      })
      .catch((err) => console.error('Erro ao carregar turnos do banco:', err));
  }, []);

  const handleChange = (turnoKey, field, value) => {
    setTurnosConfig((prev) => ({
      ...prev,
      [turnoKey]: {
        ...prev[turnoKey],
        [field]: value,
      },
    }));
  };

  const handleSave = (e) => {
    e.preventDefault();
    api.post('/api/config/turnos', turnosConfig)
      .then((res) => {
        if (isOk(res)) {
          setSavedSuccess(true);
          setTimeout(() => setSavedSuccess(false), 3000);
        } else {
          console.error('Erro ao salvar turnos: sem permissão ou sessão expirada.');
        }
      })
      .catch((err) => console.error('Erro ao salvar turnos no banco:', err));
  };

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-100 p-6 flex flex-col justify-between overflow-hidden">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
          >
            <Home size={16} /> Início
          </button>
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Settings size={22} /> Configuração de Turnos e Metas de OEE (PostgreSQL)
            </h1>
            <p className="text-slate-400 text-xs">Área restrita para supervisores e administradores da linha</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="my-auto max-w-4xl mx-auto w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-xl">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
          <Clock size={18} className="text-amber-400" /> Parâmetros Operacionais por Turno
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {Object.keys(turnosConfig).map((key) => {
            const turno = turnosConfig[key];
            return (
              <div key={key} className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 shadow-inner flex flex-col gap-4">
                <h3 className="text-amber-400 font-bold text-sm uppercase tracking-wide border-b border-slate-800 pb-2">
                  {turno.nome}
                </h3>

                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-400 text-xs font-semibold">Hora de Início:</label>
                  <input
                    type="time"
                    value={turno.inicio}
                    onChange={(e) => handleChange(key, 'inicio', e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-400 text-xs font-semibold">Hora de Término:</label>
                  <input
                    type="time"
                    value={turno.fim}
                    onChange={(e) => handleChange(key, 'fim', e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-400 text-xs font-semibold flex items-center gap-1">
                    <Target size={13} className="text-emerald-400" /> Meta OEE (%):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={turno.metaOee}
                    onChange={(e) => handleChange(key, 'metaOee', Number(e.target.value))}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button
            type="submit"
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition shadow-lg ${
              savedSuccess ? 'bg-emerald-600 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {savedSuccess ? <Check size={18} /> : <Save size={18} />}
            {savedSuccess ? 'Salvo no PostgreSQL!' : 'Salvar Alterações'}
          </button>
        </div>
      </form>

      <div className="text-center text-slate-500 text-xs pb-2">
        Forno Industrial Dashboard — Módulo de Configuração de Turnos v1.0
      </div>
    </div>
  );
}