import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Clock, RefreshCw, Save, Check, LogOut, User, Calendar, X, Bell, Maximize, Minimize, Volume2, VolumeX, Gauge, Settings, Sliders, ChevronDown, Users, ScrollText, ShieldCheck, Loader2, Search } from 'lucide-react';
import api, { isOk } from './api';
import ChartCard from './ChartCard';
import Login from './Login';
import UserSwitchModal from './UserSwitchModal';
import AlarmsView from './AlarmsView';
import OeeView from './OeeView';
import ConfigView from './ConfigView';
import SensorConfigView from './SensorConfigView';
import UserManagementView from './UserManagementView';
import ForceChangePasswordView from './ForceChangePasswordView';
import AuditLogView from './AuditLogView';
import Sidebar from './Sidebar';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('isLoggedIn') === 'true';
  });

  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || 'Operador';
  });

  const [currentUserRole, setCurrentUserRole] = useState(() => {
    return localStorage.getItem('currentUserRole') || '';
  });

  // Quando true, bloqueia o acesso ao resto do sistema até o usuário definir
  // uma senha nova (contas criadas por um administrador exigem isso no
  // primeiro login).
  const [mustChangePassword, setMustChangePassword] = useState(() => {
    return localStorage.getItem('mustChangePassword') === 'true';
  });

  const [isServerDown, setIsServerDown] = useState(false);
  const [wasServerDown, setWasServerDown] = useState(false);

  const [charts, setCharts] = useState([]);
  const [availableFields, setAvailableFields] = useState([]);
  const [sensorConfigs, setSensorConfigs] = useState({});
  const [selectedFields, setSelectedFields] = useState([]);
  
  const [timeRange, setTimeRange] = useState('1h');
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customDates, setCustomDates] = useState(null);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Mantém a tela atual ao dar F5 — antes, qualquer atualização de página
  // sempre voltava pro dashboard, mesmo se você estivesse no meio de uma
  // configuração. sessionStorage (não localStorage) de propósito: sobrevive
  // a um refresh, mas uma sessão nova (aba/janela fechada e reaberta) volta
  // a começar no dashboard, como já era o padrão esperado.
  const [currentView, setCurrentView] = useState(
    () => sessionStorage.getItem('currentView') || 'dashboard'
  );

  useEffect(() => {
    sessionStorage.setItem('currentView', currentView);
  }, [currentView]);
  const [isFieldPickerOpen, setIsFieldPickerOpen] = useState(false);
  const [fieldSearchQuery, setFieldSearchQuery] = useState('');
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);

  const [oeeMetricsData, setOeeMetricsData] = useState({
    runTimeSec: 0,
    totalCount: 0,
    goodCount: 0
  });

  // Alarmes ativos (status = ATIVO no banco), consultados periodicamente —
  // alimenta o badge do sininho e a barra de alarmes recentes no rodapé do
  // dashboard. Vem do backend (não de quais gráficos estão na tela no
  // momento), então continua confiável mesmo se o gráfico da variável em
  // alarme for removido do layout.
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [acknowledgingAlarmId, setAcknowledgingAlarmId] = useState(null);

  const fetchActiveAlarms = useCallback(async () => {
    try {
      const res = await api.get('/api/alarms', { params: { activeOnly: 'true', limit: 50 } });
      if (isOk(res) && Array.isArray(res.data)) {
        setActiveAlarms(res.data);
      }
    } catch (err) {
      console.error('Erro ao buscar alarmes ativos:', err);
    }
  }, []);

  useEffect(() => {
    fetchActiveAlarms();
    const interval = setInterval(fetchActiveAlarms, 10000);
    return () => clearInterval(interval);
  }, [fetchActiveAlarms]);

  // Mantém a lista de variáveis desta aba já aberta sincronizada com a
  // tela de Configuração de Variáveis, sem precisar recarregar a página:
  // (1) variável excluída some sozinha dos gráficos já montados (o backend
  //     já corrige o layout SALVO no momento da exclusão — ver
  //     removeFieldFromSavedLayout em server.js — isto aqui só mantém o
  //     estado em memória desta aba sincronizado com aquilo); e
  // (2) variável nova passa a aparecer no picker de "criar novo gráfico"
  //     sem precisar de F5 (antes só era buscada uma vez, no carregamento
  //     inicial da página).
  // Só ajusta `charts` quando algo realmente mudou, pra não interferir numa
  // edição em andamento (arrastar/redimensionar, etc.).
  useEffect(() => {
    const syncAvailableFields = async () => {
      try {
        const res = await api.get('/api/influx/fields');
        if (!isOk(res) || !Array.isArray(res.data)) return;
        const validFields = res.data;

        setAvailableFields((prev) => {
          const same = prev.length === validFields.length && prev.every((f) => validFields.includes(f));
          return same ? prev : validFields;
        });

        setCharts((prevCharts) => {
          let changed = false;
          const updated = prevCharts
            .map((c) => {
              const fields = Array.isArray(c.fields) ? c.fields : [];
              const filteredFields = fields.filter((f) => validFields.includes(f));
              if (filteredFields.length === fields.length) return c;
              changed = true;
              return {
                ...c,
                fields: filteredFields,
                hiddenFields: Array.isArray(c.hiddenFields)
                  ? c.hiddenFields.filter((f) => validFields.includes(f))
                  : c.hiddenFields,
              };
            })
            .filter((c) => (Array.isArray(c.fields) ? c.fields.length > 0 : true));

          return changed ? updated : prevCharts;
        });
      } catch (err) {
        console.error('Erro ao verificar variáveis excluídas:', err);
      }
    };

    const interval = setInterval(syncAvailableFields, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledgeAlarm = async (id) => {
    setAcknowledgingAlarmId(id);
    try {
      const res = await api.put(`/api/alarms/${id}/acknowledge`);
      if (isOk(res)) {
        fetchActiveAlarms();
      }
    } catch (err) {
      console.error('Erro ao reconhecer alarme:', err);
    } finally {
      setAcknowledgingAlarmId(null);
    }
  };

  const unacknowledgedAlarmsCount = activeAlarms.filter((a) => !a.acknowledged).length;
  const recentActiveAlarms = activeAlarms.slice(0, 3);
  const extraActiveAlarmsCount = Math.max(0, activeAlarms.length - recentActiveAlarms.length);

  const fetchOeeMetricsFromDb = async () => {
    try {
      const res = await api.get('/api/oee/metrics');
      if (isOk(res)) {
        const data = res.data;
        setOeeMetricsData({
          runTimeSec: data.runTimeSec || 0,
          totalCount: data.totalCount || 0,
          goodCount: data.goodCount || 0
        });
      }
    } catch (err) {
      console.error('Erro ao buscar métricas de OEE reais:', err);
    }
  };

  useEffect(() => {
    fetchOeeMetricsFromDb();
    const interval = setInterval(fetchOeeMetricsFromDb, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadInitialLayout = async () => {
    try {
      let configs = {};
      try {
        const configRes = await api.get('/api/config/sensores');
        if (isOk(configRes)) {
          configs = configRes.data;
          setSensorConfigs(configs);
        }
      } catch (err) {
        console.error('Erro ao buscar configs de sensores:', err);
      }

      const res = await api.get('/api/dashboard/layout');
      if (isOk(res)) {
        // Compatibilidade com layouts salvos antes desta versão, que
        // guardavam só o array de gráficos direto (sem as preferências de
        // atualização/período/visibilidade das penas).
        const layoutData = res.data;
        const savedCharts = Array.isArray(layoutData) ? layoutData : (layoutData?.charts || []);

        // "isNew" (ver GET /api/dashboard/layout) é a única forma confiável
        // de saber se isto é de verdade a primeira vez (nunca foi salvo
        // nada) — um array vazio sozinho não diferencia isso de "usuário
        // apagou todos os gráficos e salvou de propósito". Sem essa
        // distinção, um layout vazio salvo deliberadamente era substituído
        // pelos gráficos padrão (CTP01/CTP02) toda vez que a página
        // recarregava ou o usuário voltava de outra tela.
        const isTrulyFirstRun = !Array.isArray(layoutData) && layoutData?.isNew === true;

        if (isTrulyFirstRun) {
          setCharts([
            { id: '1', title: 'Sensor - CTP01', fields: ['CTP01'], minLimit: 100, maxLimit: 800, hiddenFields: [] },
            { id: '2', title: 'Sensor - CTP02', fields: ['CTP02'], minLimit: 100, maxLimit: 800, hiddenFields: [] }
          ]);
        } else {
          // Compatibilidade com layouts antigos salvos com "field" (string única)
          // em vez de "fields" (array) — normaliza para o novo formato.
          const normalizedCharts = (Array.isArray(savedCharts) ? savedCharts : []).map((c) => ({
            ...c,
            fields: Array.isArray(c.fields) ? c.fields : (c.field ? [c.field] : []),
            hiddenFields: Array.isArray(c.hiddenFields) ? c.hiddenFields : [],
          }));
          setCharts(normalizedCharts);
        }

        if (!Array.isArray(layoutData)) {
          if (layoutData?.refreshInterval !== undefined) setRefreshInterval(layoutData.refreshInterval);
          if (layoutData?.timeRange) setTimeRange(layoutData.timeRange);
        }
      }

      const fieldsRes = await api.get('/api/influx/fields');
      if (isOk(fieldsRes)) {
        const fieldsData = fieldsRes.data;
        if (Array.isArray(fieldsData) && fieldsData.length > 0) {
          setAvailableFields(fieldsData);
          setSelectedFields([fieldsData[0]]);
        }
      }

      setIsServerDown(false);
    } catch (err) {
      console.error('Erro na conexão com o backend:', err);
      setIsServerDown(true);
      setWasServerDown(true);
    }
  };

  useEffect(() => {
    loadInitialLayout();
  }, []);

  const toggleKioskMode = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error('Erro ao ativar tela cheia:', err);
      });
      setIsKioskMode(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      setIsKioskMode(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsKioskMode(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleLoginSuccess = (username, token, role, mustChangePasswordFlag) => {
    const userToSave = username || 'Operador';
    const roleToSave = role || '';
    setIsAuthenticated(true);
    setCurrentUser(userToSave);
    setCurrentUserRole(roleToSave);
    setMustChangePassword(!!mustChangePasswordFlag);
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('currentUser', userToSave);
    localStorage.setItem('currentUserRole', roleToSave);
    localStorage.setItem('mustChangePassword', mustChangePasswordFlag ? 'true' : 'false');
    if (token) localStorage.setItem('authToken', token);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUserRole('');
    setMustChangePassword(false);
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentUserRole');
    localStorage.removeItem('mustChangePassword');
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('currentView');
    setCurrentView('dashboard');
  };

  // Troca de usuário: mesmo fluxo do login, só que sem sair da tela atual do dashboard.
  const handleSwitchUser = (username, token, role, mustChangePasswordFlag) => {
    handleLoginSuccess(username, token, role, mustChangePasswordFlag);
  };

  // Chamado quando o usuário termina de definir a nova senha na tela obrigatória.
  const handlePasswordChanged = () => {
    setMustChangePassword(false);
    localStorage.setItem('mustChangePassword', 'false');
  };

  const handleApplyCustomDates = (e) => {
    e.preventDefault();
    if (startDate && endDate) {
      setCustomDates({ startDate, endDate });
    }
  };

  const handleClearCustomDates = () => {
    setStartDate('');
    setEndDate('');
    setCustomDates(null);
  };

  const handleUpdateChartLimits = useCallback((chartId, minLimit, maxLimit) => {
    setCharts((prevCharts) =>
      prevCharts.map((c) =>
        c.id === chartId ? { ...c, minLimit, maxLimit } : c
      )
    );
  }, []);

  // Guarda quais "penas" (variáveis) estão ocultas em cada gráfico direto no
  // estado do gráfico — assim isso é incluído quando o layout é salvo (ver
  // handleSaveLayout) e volta do jeito que estava depois de um F5.
  const handleHiddenFieldsChange = useCallback((chartId, hiddenFields) => {
    setCharts((prevCharts) =>
      prevCharts.map((c) =>
        c.id === chartId ? { ...c, hiddenFields } : c
      )
    );
  }, []);

  const handleRemoveChart = useCallback((id) => {
    setCharts((prevCharts) => prevCharts.filter((chart) => chart.id !== id));
  }, []);

  // Telas de configuração (Turnos e Variáveis) são restritas a Supervisor e Administrador.
  const canConfig = currentUserRole === 'supervisor' || currentUserRole === 'administrador';

  // Gerenciamento de usuários e auditoria (redefinir senha, alterar perfil,
  // ver histórico de alterações) são restritos a Administrador.
  const canManageUsers = currentUserRole === 'administrador';
  const canViewAudit = currentUserRole === 'administrador';

  // Defesa extra: se por algum motivo o estado cair numa tela restrita sem
  // permissão (ex.: troca de usuário para um perfil sem acesso enquanto a
  // tela já estava aberta), volta para o dashboard automaticamente.
  useEffect(() => {
    const restrictedViews = ['configTurnos', 'configSensores'];
    if (restrictedViews.includes(currentView) && !canConfig) {
      setCurrentView('dashboard');
    }
    if (currentView === 'userManagement' && !canManageUsers) {
      setCurrentView('dashboard');
    }
    if (currentView === 'auditLog' && !canViewAudit) {
      setCurrentView('dashboard');
    }
  }, [currentView, canConfig, canManageUsers, canViewAudit]);

  if (!isAuthenticated || isServerDown) {
    return (
      <Login
        onLoginSuccess={handleLoginSuccess}
        isServerDown={isServerDown}
      />
    );
  }

  // Bloqueia o resto do sistema até o usuário definir uma senha nova —
  // acontece só para contas criadas por um administrador, no primeiro login.
  if (mustChangePassword) {
    return (
      <ForceChangePasswordView
        currentUser={currentUser}
        onPasswordChanged={handlePasswordChanged}
        onLogout={handleLogout}
      />
    );
  }

  // Barra lateral igual em todas as telas (menos login/troca de senha, que
  // vêm antes disso) — cada tela abaixo só troca o que aparece à direita
  // dela. O botão da tela atual não aparece sozinho (ver Sidebar.jsx).
  const sidebarProps = {
    currentView,
    onNavigate: setCurrentView,
    canConfig,
    canManageUsers,
    canViewAudit,
    unacknowledgedAlarmsCount,
    currentUser,
    onOpenUserModal: () => setIsUserModalOpen(true),
    onLogout: handleLogout,
  };

  if (currentView === 'oee') {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <OeeView
            onBack={() => setCurrentView('dashboard')}
            onOpenConfig={() => setCurrentView('configTurnos')}
            oeeData={oeeMetricsData}
            canConfig={canConfig}
          />
        </div>
        <UserSwitchModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          currentUser={currentUser}
          currentUserRole={currentUserRole}
        />
      </div>
    );
  }

  if (currentView === 'configTurnos' && canConfig) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <ConfigView onBack={() => setCurrentView('dashboard')} />
        </div>
        <UserSwitchModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          currentUser={currentUser}
          currentUserRole={currentUserRole}
        />
      </div>
    );
  }

  if (currentView === 'configSensores' && canConfig) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <SensorConfigView
            onBack={() => {
              setCurrentView('dashboard');
              loadInitialLayout();
            }}
          />
        </div>
        <UserSwitchModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          currentUser={currentUser}
          currentUserRole={currentUserRole}
        />
      </div>
    );
  }

  if (currentView === 'userManagement' && canManageUsers) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <UserManagementView onBack={() => setCurrentView('dashboard')} currentUser={currentUser} />
        </div>
        <UserSwitchModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          currentUser={currentUser}
          currentUserRole={currentUserRole}
        />
      </div>
    );
  }

  if (currentView === 'auditLog' && canViewAudit) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <AuditLogView onBack={() => setCurrentView('dashboard')} />
        </div>
        <UserSwitchModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          currentUser={currentUser}
          currentUserRole={currentUserRole}
        />
      </div>
    );
  }

  if (currentView === 'alarms') {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <AlarmsView onBack={() => setCurrentView('dashboard')} currentUserRole={currentUserRole} />
        </div>
        <UserSwitchModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          currentUser={currentUser}
          currentUserRole={currentUserRole}
        />
      </div>
    );
  }

  const handleSaveLayout = async () => {
    try {
      // Além de quais gráficos existem, salva também as preferências de
      // visualização (visibilidade de cada pena já vem dentro de cada
      // gráfico em "charts"; atualização e atalho de período são globais).
      const response = await api.post('/api/dashboard/layout', { charts, refreshInterval, timeRange });

      if (isOk(response)) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Erro ao salvar layout:', err);
      setIsServerDown(true);
      setWasServerDown(true);
    }
  };

  const handleAddChart = (e) => {
    e.preventDefault();
    if (!selectedFields || selectedFields.length === 0) return;

    const alreadyDisplayed = charts.some(
      (c) => Array.isArray(c.fields) && c.fields.length === selectedFields.length &&
        selectedFields.every((f) => c.fields.includes(f))
    );
    if (alreadyDisplayed) {
      alert("Essa combinação de variáveis já está sendo exibida na tela!");
      return;
    }

    const friendlyName = selectedFields
      .map((f) => sensorConfigs[f]?.descricao || f)
      .join(' + ');

    const firstField = selectedFields[0];
    const newChart = {
      id: Date.now().toString(),
      title: friendlyName,
      fields: selectedFields,
      minLimit: sensorConfigs[firstField]?.minLimit ?? 100,
      maxLimit: sensorConfigs[firstField]?.maxLimit ?? 800
    };

    setCharts([...charts, newChart]);
  };

  const handleToggleFieldSelection = (field) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-100 flex overflow-hidden">
      <Sidebar {...sidebarProps} />

      {/* Conteúdo principal */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-amber-500">
              Dashboard - Forno Industrial
            </h1>
            <p className="text-slate-400 text-xs">
              Monitoramento de sensores e variáveis historizadas em tempo real
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-xs font-semibold transition ${
                isMuted
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {isMuted ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} />}
              {isMuted ? 'Mudo' : 'Som'}
            </button>

            <button
              onClick={toggleKioskMode}
              className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-xs font-semibold transition ${
                isKioskMode
                  ? 'bg-amber-600 text-white border-amber-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              {isKioskMode ? <Minimize size={14} /> : <Maximize size={14} />}
              {isKioskMode ? 'Sair TV' : 'Modo TV'}
            </button>

            <button
              onClick={handleSaveLayout}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition ${
                savedSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700'
              }`}
            >
              {savedSuccess ? <Check size={14} /> : <Save size={14} />}
              {savedSuccess ? 'Salvo!' : 'Salvar'}
            </button>

            <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1">
              <RefreshCw size={14} className={`text-amber-500 ${refreshInterval > 0 && !customDates ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
              <select
                value={refreshInterval}
                disabled={!!customDates}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="bg-slate-900 text-slate-200 text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none disabled:opacity-50"
              >
                <option value={5000}>5s</option>
                <option value={15000}>15s</option>
                <option value={30000}>30s</option>
                <option value={0}>Off</option>
              </select>
            </div>

            <form onSubmit={handleAddChart} className="flex gap-1.5 relative">
              <button
                type="button"
                onClick={() => {
                  setIsFieldPickerOpen((prev) => {
                    if (prev) setFieldSearchQuery('');
                    return !prev;
                  });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none font-mono min-w-[140px] justify-between"
              >
                <span className="truncate">
                  {selectedFields.length === 0
                    ? 'Selecionar variáveis...'
                    : selectedFields.length === 1
                    ? (sensorConfigs[selectedFields[0]]?.descricao || selectedFields[0])
                    : `${selectedFields.length} variáveis selecionadas`}
                </span>
                <ChevronDown size={13} className="text-amber-400 shrink-0" />
              </button>

              {isFieldPickerOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-slate-800 border border-slate-700 rounded shadow-xl w-64 max-h-80 flex flex-col p-1.5">
                  <p className="text-[10px] text-slate-400 px-1.5 pb-1 uppercase font-semibold shrink-0">
                    Marque uma ou mais variáveis
                  </p>
                  <div className="relative mb-1.5 shrink-0">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      autoFocus
                      value={fieldSearchQuery}
                      onChange={(e) => setFieldSearchQuery(e.target.value)}
                      placeholder="Digite para buscar..."
                      className="w-full bg-slate-900 border border-slate-700 rounded pl-6 pr-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="overflow-y-auto">
                    {(() => {
                      const query = fieldSearchQuery.trim().toLowerCase();
                      const filteredFields = query
                        ? availableFields.filter((field) => {
                            const friendlyDesc = sensorConfigs[field]?.descricao || '';
                            return field.toLowerCase().includes(query) || friendlyDesc.toLowerCase().includes(query);
                          })
                        : availableFields;

                      if (filteredFields.length === 0) {
                        return (
                          <p className="text-[11px] text-slate-500 px-1.5 py-2 text-center">
                            Nenhuma variável encontrada.
                          </p>
                        );
                      }

                      return filteredFields.map((field) => {
                        const friendlyDesc = sensorConfigs[field]?.descricao;
                        const checked = selectedFields.includes(field);
                        return (
                          <label
                            key={field}
                            className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-700/60 cursor-pointer text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleFieldSelection(field)}
                              className="accent-amber-500"
                            />
                            <span className="truncate">
                              {friendlyDesc ? `${friendlyDesc} (${field})` : field}
                            </span>
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              <button
                type="submit"
                onClick={() => {
                  setIsFieldPickerOpen(false);
                  setFieldSearchQuery('');
                }}
                className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1 rounded text-xs font-medium"
              >
                <Plus size={14} /> Adicionar
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-2 rounded border border-slate-800 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-slate-400 pr-1 flex items-center gap-1 font-semibold uppercase">
              <Clock size={13} /> Atalhos:
            </span>
            {[
              { label: '1h', value: '1h' },
              { label: '8h', value: '8h' },
              { label: '24h', value: '24h' },
              { label: '7d', value: '7d' }
            ].map((btn) => (
              <button
                key={btn.value}
                onClick={() => {
                  setTimeRange(btn.value);
                  handleClearCustomDates();
                }}
                className={`px-2.5 py-0.5 rounded font-medium transition ${
                  timeRange === btn.value && !customDates
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleApplyCustomDates} className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-semibold uppercase flex items-center gap-1">
              <Calendar size={13} /> Período:
            </span>

            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-200 focus:outline-none focus:border-amber-500"
              required
            />

            <span className="text-slate-500">até</span>

            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-200 focus:outline-none focus:border-amber-500"
              required
            />

            <button
              type="submit"
              className="bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-0.5 rounded font-medium transition"
            >
              Filtrar
            </button>

            {customDates && (
              <button
                type="button"
                onClick={handleClearCustomDates}
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded transition border border-slate-700"
              >
                <X size={12} /> Limpar
              </button>
            )}
          </form>
        </div>
      </header>

      <div 
        className={`grid gap-3 w-full flex-1 overflow-hidden ${
          charts.length === 1 ? 'grid-cols-1 grid-rows-1' : 
          charts.length === 2 ? 'grid-cols-2 grid-rows-1' : 
          charts.length <= 4 ? 'grid-cols-2 grid-rows-2' : 
          'grid-cols-3 grid-rows-2'
        }`}
      >
        {charts.map((chart) => (
          <div key={chart.id} className="h-full w-full overflow-hidden flex flex-col">
            <ChartCard
              chart={chart}
              timeRange={timeRange}
              customDates={customDates}
              refreshInterval={refreshInterval}
              onRemove={handleRemoveChart}
              onUpdateLimits={handleUpdateChartLimits}
              onHiddenFieldsChange={handleHiddenFieldsChange}
              isMuted={isMuted}
            />
          </div>
        ))}
      </div>

      {recentActiveAlarms.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 bg-red-950/30 border border-red-500/30 rounded-lg px-3 py-2 mt-3">
          <span className="flex items-center gap-1.5 text-red-400 text-xs font-bold uppercase shrink-0">
            <Bell size={13} className="animate-pulse" /> Alarmes ativos:
          </span>
          {recentActiveAlarms.map((alarm) => (
            <div
              key={alarm.id}
              className="flex items-center gap-2 bg-slate-900/70 border border-red-500/30 rounded px-2.5 py-1 text-xs"
            >
              <span className="font-bold text-amber-400">{alarm.field_name}</span>
              <span className="font-mono text-red-400">{alarm.value_read}</span>
              <span className="text-slate-500">desde {alarm.formatted_date}</span>
              {alarm.acknowledged ? (
                <span className="flex items-center gap-1 text-emerald-400 text-[10px]">
                  <ShieldCheck size={11} /> Reconhecido
                </span>
              ) : (
                <button
                  onClick={() => handleAcknowledgeAlarm(alarm.id)}
                  disabled={acknowledgingAlarmId === alarm.id}
                  className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-2 py-0.5 rounded text-[10px] font-semibold transition"
                >
                  {acknowledgingAlarmId === alarm.id ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />} Reconhecer
                </button>
              )}
            </div>
          ))}
          {extraActiveAlarmsCount > 0 && (
            <button
              onClick={() => setCurrentView('alarms')}
              className="text-[11px] text-slate-400 hover:text-amber-400 underline shrink-0"
            >
              +{extraActiveAlarmsCount} outro(s) ativo(s)
            </button>
          )}
        </div>
      )}

      </div>

      <UserSwitchModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        onSwitchUser={handleSwitchUser}
        onLogout={handleLogout}
        currentUser={currentUser}
        currentUserRole={currentUserRole}
      />
    </div>
  );
}