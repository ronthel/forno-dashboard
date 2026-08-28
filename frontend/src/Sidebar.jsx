import React from 'react';
import { Home, Gauge, Settings, Sliders, Users, ScrollText, Bell, User, LogOut, Clock, Wrench, ClipboardList, Scale } from 'lucide-react';

// Ordem e posição fixas de propósito — os botões nunca somem nem trocam de
// lugar conforme a tela muda (só a permissão do usuário decide se aparecem
// ou não). A tela atual fica destacada (classe "active" abaixo), em vez de
// escondida como era antes.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home },
  { key: 'oee', label: 'Relatório OEE', icon: Gauge },
  { key: 'relatorioExecutivo', label: 'Relatório Executivo', icon: ClipboardList },
  { key: 'paradas', label: 'Paradas', icon: Clock },
  { key: 'perdas', label: 'Perdas', icon: Scale },
  { key: 'configTurnos', label: 'Turnos', icon: Settings, requires: 'canConfig' },
  { key: 'configOee', label: 'Parâmetros OEE', icon: Wrench, requires: 'canConfig' },
  { key: 'configPerdas', label: 'Parâmetros Perdas', icon: Wrench, requires: 'canConfig' },
  { key: 'configSensores', label: 'Variáveis', icon: Sliders, requires: 'canConfig' },
  { key: 'userManagement', label: 'Usuários', icon: Users, requires: 'canManageUsers' },
  { key: 'auditLog', label: 'Auditoria', icon: ScrollText, requires: 'canViewAudit' },
  { key: 'alarms', label: 'Alarmes', icon: Bell },
];

// Barra lateral de navegação — usada em TODAS as telas do dashboard.
// Usuário atual/logout também moram aqui, fixados no rodapé.
export default function Sidebar({
  currentView,
  onNavigate,
  canConfig,
  canManageUsers,
  canViewAudit,
  unacknowledgedAlarmsCount = 0,
  pendingParadasCount = 0,
  currentUser,
  onOpenUserModal,
  onLogout,
}) {
  const permissions = { canConfig, canManageUsers, canViewAudit };

  return (
    <aside className="w-44 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col gap-1.5 p-3 overflow-y-auto">
      <div className="mb-2 px-0.5">
        <p className="text-amber-500 font-bold text-sm leading-tight">Forno Industrial</p>
        <p className="text-slate-500 text-[10px]">Dashboard</p>
      </div>

      {NAV_ITEMS.map(({ key, label, icon: Icon, requires }) => {
        if (requires && !permissions[requires]) return null;

        const isActive = currentView === key;
        const isAlarmAlert = key === 'alarms' && !isActive && unacknowledgedAlarmsCount > 0;
        const isParadaAlert = key === 'paradas' && !isActive && pendingParadasCount > 0;

        const className = isActive
          ? 'flex items-center gap-2 bg-amber-600 text-white border border-amber-500 px-3 py-2 rounded text-xs font-semibold shadow-md'
          : isAlarmAlert
          ? 'flex items-center gap-2 bg-red-600 text-white border border-red-500 animate-pulse px-3 py-2 rounded text-xs font-semibold transition'
          : isParadaAlert
          ? 'flex items-center gap-2 bg-amber-700/80 text-white border border-amber-600 px-3 py-2 rounded text-xs font-semibold transition'
          : 'flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded text-xs font-semibold transition';

        return (
          <button key={key} onClick={() => onNavigate(key)} className={className}>
            <Icon size={15} className={isActive || isAlarmAlert || isParadaAlert ? '' : 'text-amber-400'} />
            {label}
            {key === 'alarms' && unacknowledgedAlarmsCount > 0 && ` (${unacknowledgedAlarmsCount})`}
            {key === 'paradas' && pendingParadasCount > 0 && ` (${pendingParadasCount})`}
          </button>
        );
      })}

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
