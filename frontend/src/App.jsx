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

  const [currentView, setCurrentView] = useState('dashboard');
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
        const savedCharts = res.data;
        if (Array.isArray(savedCharts) && savedCharts.length > 0) {
          // Compatibilidade com layouts antigos salvos com "field" (string única)
          // em vez de "fields" (array) — normaliza para o novo formato.
          const normalizedCharts = savedCharts.map((c) => ({
            ...c,
            fields: Array.isArray(c.fields) ? c.fields : (c.field ? [c.field] : []),
          }));
          setCharts(normalizedCharts);
        } else {
          setCharts([
            { id: '1', title: 'Sensor - CTP01', fields: ['CTP01'], minLimit: 100, maxLimit: 800 },
            { id: '2', title: 'Sensor - CTP02', fields: ['CTP02'], minLimit: 100, maxLimit: 800 }
          ]);
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

  if (currentView === 'oee') {
    return (
      <OeeView
        onBack={() => setCurrentView('dashboard')}
        onOpenConfig={() => setCurrentView('configTurnos')}
        oeeData={oeeMetricsData}
        canConfig={canConfig}
      />
    );
  }

  if (currentView === 'configTurnos' && canConfig) {
    return <ConfigView onBack={() => setCurrentView('dashboard')} />;
  }

  if (currentView === 'configSensores' && canConfig) {
    return (
      <SensorConfigView
        onBack={() => {
          setCurrentView('dashboard');
          loadInitialLayout();
        }}
      />
    );
  }

  if (currentView === 'userManagement' && canManageUsers) {
    return <UserManagementView onBack={() => setCurrentView('dashboard')} currentUser={currentUser} />;
  }

  if (currentView === 'auditLog' && canViewAudit) {
    return <AuditLogView onBack={() => setCurrentView('dashboard')} />;
  }

  if (currentView === 'alarms') {
    return <AlarmsView onBack={() => setCurrentView('dashboard')} currentUserRole={currentUserRole} />;
  }

  const handleSaveLayout = async () => {
    try {
      const response = await api.post('/api/dashboard/layout', { charts });

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
    <div className="h-screen w-screen bg-slate-900 text-slate-100 p-4 flex flex-col justify-between overflow-hidden">
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
              onClick={() => setCurrentView('oee')}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
            >
              <Gauge size={14} /> Relatório OEE
            </button>

            {canConfig && (
              <button
                onClick={() => setCurrentView('configTurnos')}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
              >
                <Settings size={14} className="text-amber-400" /> Turnos
              </button>
            )}

            {canConfig && (
              <button
                onClick={() => setCurrentView('configSensores')}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
              >
                <Sliders size={14} className="text-amber-400" /> Variáveis
              </button>
            )}

            {canManageUsers && (
              <button
                onClick={() => setCurrentView('userManagement')}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
              >
                <Users size={14} className="text-amber-400" /> Usuários
              </button>
            )}

            {canViewAudit && (
              <button
                onClick={() => setCurrentView('auditLog')}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
              >
                <ScrollText size={14} className="text-amber-400" /> Auditoria
              </button>
            )}

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
              onClick={() => setCurrentView('alarms')}
              className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-xs font-semibold transition ${
                unacknowledgedAlarmsCount > 0
                  ? 'bg-red-600 text-white border-red-500 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-red-400 border-slate-700'
              }`}
            >
              <Bell size={14} /> Alarmes {unacknowledgedAlarmsCount > 0 && `(${unacknowledgedAlarmsCount})`}
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

            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded pl-2 pr-1 py-1">
              <button
                onClick={() => setIsUserModalOpen(true)}
                title="Trocar usuário, criar usuário ou sair"
                className="flex items-center gap-1 text-xs text-slate-300 hover:text-amber-400 transition"
              >
                <User size={13} className="text-amber-500" />
                <span className="font-medium max-w-[80px] truncate" title={currentUser}>
                  {currentUser}
                </span>
              </button>
              <button
                onClick={handleLogout}
                title="Sair"
                className="flex items-center gap-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white px-1.5 py-0.5 rounded text-xs font-medium transition border border-red-500/30"
              >
                <LogOut size={12} />
              </button>
            </div>
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