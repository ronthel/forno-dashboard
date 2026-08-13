import React from 'react';
import { Activity, AlertTriangle, ShieldCheck, Cpu, Gauge } from 'lucide-react';

export default function KpiPanel({ charts, activeAlertsCount, uptimePercentage }) {
  const totalSensors = charts.length;
  const hasAlerts = activeAlertsCount > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* KPI 1: Sensores */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-4 flex items-center justify-between shadow-md">
        <div>
          <p className="text-slate-400 text-xs font-medium uppercase">Sensores</p>
          <h3 className="text-xl font-bold text-slate-100">{totalSensors} Ativos</h3>
        </div>
        <Cpu size={22} className="text-amber-500" />
      </div>

      {/* KPI 2: Disponibilidade */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-4 flex items-center justify-between shadow-md">
        <div>
          <p className="text-slate-400 text-xs font-medium uppercase">Disponibilidade</p>
          <h3 className="text-xl font-bold text-blue-400">{uptimePercentage}%</h3>
        </div>
        <Activity size={22} className="text-blue-400" />
      </div>

      {/* KPI 3: Condição Operacional */}
      <div className={`border rounded-lg p-4 flex items-center justify-between shadow-md transition-all ${
        hasAlerts ? 'bg-red-950/40 border-red-500/60' : 'bg-slate-800/80 border-slate-700/60'
      }`}>
        <div>
          <p className="text-slate-400 text-xs font-medium uppercase">Status</p>
          <h3 className={`text-sm font-bold ${hasAlerts ? 'text-red-400' : 'text-emerald-400'}`}>
            {hasAlerts ? `${activeAlertsCount} Alertas` : 'Operando'}
          </h3>
        </div>
        {hasAlerts ? <AlertTriangle size={22} className="text-red-400" /> : <ShieldCheck size={22} className="text-emerald-400" />}
      </div>

      {/* KPI 4: Eficiência Global (OEE) */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-4 flex items-center justify-between shadow-md">
        <div>
          <p className="text-slate-400 text-xs font-medium uppercase">OEE Estimado</p>
          <h3 className="text-xl font-bold text-amber-400">
            {hasAlerts ? (uptimePercentage * 0.85).toFixed(1) : uptimePercentage}%
          </h3>
        </div>
        <Gauge size={22} className="text-amber-400" />
      </div>
    </div>
  );
}