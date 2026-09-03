import React, { useState, useEffect } from 'react';
import api from './api';
import { X, AlertTriangle, RefreshCw } from 'lucide-react';
import { tipoAlarmeInfo } from './alarmTipo';

export default function AlarmModal({ isOpen, onClose }) {
  const [alarms, setAlarms] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAlarms = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/alarms');
      const data = res.data;
      if (Array.isArray(data)) {
        setAlarms(data);
      }
    } catch (err) {
      console.error('Erro ao buscar histórico de alarmes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAlarms();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Cabeçalho */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-red-500" size={20} />
            <h2 className="text-lg font-bold text-slate-100">Histórico de Alarmes e Desvios</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAlarms}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
              title="Atualizar"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabela de Registros */}
        <div className="p-6 overflow-y-auto flex-1">
          {alarms.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhum evento de alarme registrado até o momento.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase">
                  <th className="py-2.5 px-3">Data e Hora</th>
                  <th className="py-2.5 px-3">Variável</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Valor Lido</th>
                  <th className="py-2.5 px-3">Limite Configurado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200 font-mono">
                {alarms.map((alarm) => (
                  <tr key={alarm.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3 text-slate-400">{alarm.formatted_date}</td>
                    <td className="py-2.5 px-3 font-bold text-amber-400">{alarm.field_name}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tipoAlarmeInfo(alarm.limit_type).badge}`}>
                        {tipoAlarmeInfo(alarm.limit_type).label.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-red-400">{alarm.value_read}</td>
                    <td className="py-2.5 px-3 text-slate-400">{alarm.limit_value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}