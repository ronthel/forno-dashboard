import React from 'react';
import { Home, Gauge, Settings, Sliders, Users, ScrollText, Bell, User, LogOut } from 'lucide-react';

// Barra lateral de navegação entre telas — usada em TODAS as telas do
// dashboard (não só na principal). O botão da tela em que você já está
// não aparece, já que não faz sentido "navegar" pra onde você já está.
// Usuário atual/logout também moraram aqui — antes só existiam no cabeçalho
// do dashboard, então trocar de usuário ou sair só dava pra fazer de lá.
export default function Sidebar({
  currentView,
  onNavigate,
  canConfig,
  canManageUsers,
  canViewAudit,
  unacknowledgedAlarmsCount = 0,
  currentUser,
  onOpenUserModal,
  onLogout,
}) {
  return (
    <aside className="w-44 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col gap-1.5 p-3 overflow-y-auto">
      <div className="mb-2 px-0.5">
        <p className="text-amber-500 font-bold text-sm leading-tight">Forno Industrial</p>
        <p className="text-slate-500 text-[10px]">Dashboard</p>
      </div>

      {currentView !== 'dashboard' && (
        <button
          onClick={() => onNavigate('dashboard')}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition"
        >
          <Home size={15} className="text-amber-400" /> Dashboard
        </button>
      )}

      {currentView !== 'oee' && (
        <button
          onClick={() => onNavigate('oee')}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded text-xs font-semibold transition shadow-md"
        >
          <Gauge size={15} /> Relatório OEE
        </button>
      )}

      {canConfig && currentView !== 'configTurnos' && (
        <button
          onClick={() => onNavigate('configTurnos')}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition"
        >
          <Settings size={15} className="text-amber-400" /> Turnos
        </button>
      )}

      {canConfig && currentView !== 'configSensores' && (
        <button
          onClick={() => onNavigate('configSensores')}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition"
        >
          <Sliders size={15} className="text-amber-400" /> Variáveis
        </button>
      )}

      {canManageUsers && currentView !== 'userManagement' && (
        <button
          onClick={() => onNavigate('userManagement')}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition"
        >
          <Users size={15} className="text-amber-400" /> Usuários
        </button>
      )}

      {canViewAudit && currentView !== 'auditLog' && (
        <button
          onClick={() => onNavigate('auditLog')}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition"
        >
          <ScrollText size={15} className="text-amber-400" /> Auditoria
        </button>
      )}

      {currentView !== 'alarms' && (
        <button
          onClick={() => onNavigate('alarms')}
          className={`flex items-center gap-2 border px-3 py-2 rounded text-xs font-semibold transition ${
            unacknowledgedAlarmsCount > 0
              ? 'bg-red-600 text-white border-red-500 animate-pulse'
              : 'bg-slate-800 hover:bg-slate-700 text-red-400 border-slate-700'
          }`}
        >
          <Bell size={15} /> Alarmes {unacknowledgedAlarmsCount > 0 && `(${unacknowledgedAlarmsCount})`}
        </button>
      )}

      {/* Usuário/logout fixados embaixo, separados dos atalhos de navegação */}
      <div className="mt-auto pt-2 border-t border-slate-800 flex flex-col gap-1.5">
        <button
          onClick={onOpenUserModal}
          title="Trocar usuário, criar usuário ou sair"
          className="flex items-center gap-2 text-xs text-slate-300 hover:text-amber-400 hover:bg-slate-800 transition px-3 py-2 rounded"
        >
          <User size={14} className="text-amber-500 shrink-0" />
          <span className="font-medium truncate" title={currentUser}>
            {currentUser}
          </span>
        </button>
        <button
          onClick={onLogout}
          title="Sair"
          className="flex items-center justify-center gap-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white px-3 py-1.5 rounded text-xs font-medium transition border border-red-500/30"
        >
          <LogOut size={13} /> Sair
        </button>
      </div>
    </aside>
  );
}
