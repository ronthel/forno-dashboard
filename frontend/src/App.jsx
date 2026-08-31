import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Clock, RefreshCw, Save, Check, LogOut, User, Calendar, X, Bell, Maximize, Minimize, Volume2, VolumeX, Gauge, Settings, Sliders, ChevronDown, Users, ScrollText, ShieldCheck, Loader2, Search, LayoutGrid, Pencil, Trash2 } from 'lucide-react';
import api, { isOk } from './api';
import ChartCard from './ChartCard';
import Login from './Login';
import UserSwitchModal from './UserSwitchModal';
import AlarmsView from './AlarmsView';
import ParadasView from './ParadasView';
import OeeView from './OeeView';
import ConfigView from './ConfigView';
import OeeConfigView from './OeeConfigView';
import RelatorioExecutivoView from './RelatorioExecutivoView';
import PerdasView from './PerdasView';
import PerdasConfigView from './PerdasConfigView';
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

  // Cada usuário pode ter vários dashboards nomeados (ex: "Temperaturas do
  // Forno", "Pressões") — dashboardsList é só {id, name, updatedAt} de cada
  // um (pro seletor); o conteúdo completo (charts/refreshInterval/timeRange)
  // só é buscado do que estiver aberto no momento, guardado em
  // currentDashboardId.
  const [dashboardsList, setDashboardsList] = useState([]);
  const [currentDashboardId, setCurrentDashboardId] = useState(null);
  const [isDashboardPickerOpen, setIsDashboardPickerOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [renamingDashboard, setRenamingDashboard] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [dashboardError, setDashboardError] = useState('');
  
  const [timeRange, setTimeRange] = useState('24h');
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

  // Métricas dos 3 turnos configurados (turnos_config), cada um com sua
  // própria ocorrência mais recente — ver GET /api/oee/metrics.
  const [oeeMetricsData, setOeeMetricsData] = useState({
    configured: false,
    velocidadeNominalPpm: 50,
    turnos: {},
    statusMaquina: { rodando: null, desde: null }
  });
  // Intervalo de atualização automática da tela de OEE — separado do
  // refreshInterval do dashboard principal, porque faz sentido acompanhar o
  // OEE bem mais de perto (ex: 1s) sem precisar deixar os gráficos do
  // dashboard nessa mesma frequência.
  const [oeeRefreshInterval, setOeeRefreshInterval] = useState(1000);

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

  // Contagem de paradas detectadas automaticamente que ainda não foram
  // classificadas por ninguém — badge no menu, mesmo padrão dos alarmes.
  const [pendingParadasCount, setPendingParadasCount] = useState(0);

  const fetchPendingParadasCount = useCallback(async () => {
    try {
      const res = await api.get('/api/paradas', { params: { status: 'pendentes' } });
      if (isOk(res) && Array.isArray(res.data)) {
        setPendingParadasCount(res.data.length);
      }
    } catch (err) {
      console.error('Erro ao buscar paradas pendentes:', err);
    }
  }, []);

  useEffect(() => {
    fetchPendingParadasCount();
    const interval = setInterval(fetchPendingParadasCount, 15000);
    return () => clearInterval(interval);
  }, [fetchPendingParadasCount]);

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
          configured: !!data.configured,
          velocidadeNominalPpm: data.velocidadeNominalPpm || 50,
          turnos: data.turnos || {},
          statusMaquina: data.statusMaquina || { rodando: null, desde: null }
        });
      }
    } catch (err) {
      console.error('Erro ao buscar métricas de OEE reais:', err);
    }
  };

  useEffect(() => {
    fetchOeeMetricsFromDb();
    if (oeeRefreshInterval <= 0) return; // "Off" — só a busca inicial acima, sem repetir
    const interval = setInterval(fetchOeeMetricsFromDb, oeeRefreshInterval);
    return () => clearInterval(interval);
  }, [oeeRefreshInterval]);

  // Protege contra respostas "fora de ordem": se o usuário logar/trocar de
  // conta de novo antes da busca anterior terminar (ex: sair do operador e
  // entrar como wtecc rapidinho), a resposta antiga — ainda em voo, pedida
  // com o token de quem já saiu — pode chegar DEPOIS da nova e sobrescrever
  // os dados certos com os de outra pessoa. Cada chamada de loadInitialLayout
  // pega um número de geração; se uma geração mais nova já começou antes de
  // uma etapa terminar, essa resposta é descartada em vez de aplicada.
  const loadGenerationRef = useRef(0);

  const loadInitialLayout = async () => {
    const myGeneration = ++loadGenerationRef.current;
    const isStale = () => myGeneration !== loadGenerationRef.current;
    try {
      let configs = {};
      try {
        const configRes = await api.get('/api/config/sensores');
        if (isStale()) return;
        if (isOk(configRes)) {
          configs = configRes.data;
          setSensorConfigs(configs);
        }
      } catch (err) {
        console.error('Erro ao buscar configs de sensores:', err);
      }

      // Lista os dashboards do usuário (o backend garante que sempre existe
      // pelo menos um — "Principal", criado automaticamente na primeira
      // visita) e abre o último que essa pessoa tinha aberto nesse
      // navegador, ou o mais recentemente atualizado se não houver lembrança
      // (primeiro acesso, ou o lembrado foi excluído nesse meio-tempo).
      const dashRes = await api.get('/api/dashboards');
      if (isStale()) return;
      if (isOk(dashRes)) {
        const list = Array.isArray(dashRes.data) ? dashRes.data : [];
        setDashboardsList(list);

        const remembered = localStorage.getItem(`lastDashboardId_${currentUser}`);
        let target = list.find((d) => String(d.id) === remembered);
        if (!target && list.length > 0) {
          target = [...list].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
        }

        if (target) {
          const detailRes = await api.get(`/api/dashboards/${target.id}`);
          if (isStale()) return;
          if (isOk(detailRes)) {
            const data = detailRes.data;
            // Compatibilidade com layouts antigos salvos com "field" (string
            // única) em vez de "fields" (array) — normaliza para o formato novo.
            const normalizedCharts = (Array.isArray(data.charts) ? data.charts : []).map((c) => ({
              ...c,
              fields: Array.isArray(c.fields) ? c.fields : (c.field ? [c.field] : []),
              hiddenFields: Array.isArray(c.hiddenFields) ? c.hiddenFields : [],
            }));
            setCharts(normalizedCharts);
            if (data.refreshInterval !== undefined) setRefreshInterval(data.refreshInterval);
            if (data.timeRange) setTimeRange(data.timeRange);
            setCurrentDashboardId(target.id);
          }
        }
      }

      const fieldsRes = await api.get('/api/influx/fields');
      if (isStale()) return;
      if (isOk(fieldsRes)) {
        const fieldsData = fieldsRes.data;
        if (Array.isArray(fieldsData) && fieldsData.length > 0) {
          setAvailableFields(fieldsData);
          setSelectedFields([fieldsData[0]]);
        }
      }

      setIsServerDown(false);
    } catch (err) {
      if (isStale()) return;
      console.error('Erro na conexão com o backend:', err);
      setIsServerDown(true);
      setWasServerDown(true);
    }
  };

  // Recarrega o dashboard (gráficos, config de sensores etc.) toda vez que o
  // usuário autenticado muda — tanto no login normal quanto no "Trocar
  // usuário" (handleSwitchUser), que troca o token sem sair da tela atual.
  // Sem isso, os dashboards (por usuário — ver /api/dashboards) carregados
  // pra a pessoa anterior continuavam na tela emprestados pra quem entrou
  // depois, porque nada mandava buscar de novo.
  useEffect(() => {
    if (isAuthenticated) loadInitialLayout();
  }, [isAuthenticated, currentUser]);

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
    setCurrentUser('');
    setCurrentUserRole('');
    setMustChangePassword(false);
    // Limpa o dashboard da pessoa que está saindo — sem isso, ele ficava em
    // memória (mesmo escondido atrás da tela de login) e podia reaparecer
    // emprestado pro próximo login se a busca nova demorasse ou falhasse.
    setCharts([]);
    setDashboardsList([]);
    setCurrentDashboardId(null);
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentUserRole');
    localStorage.removeItem('mustChangePassword');
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('currentView');
    setCurrentView('dashboard');
  };

  // Troca de usuário: mesmo fluxo do login, só que sem sair da tela atual do
  // dashboard. Limpa o layout atual antes de trocar pra não deixar o
  // dashboard da pessoa anterior visível nem por um instante — o efeito
  // acima (dependente de isAuthenticated/currentUser) já busca o layout do
  // novo usuário em seguida.
  const handleSwitchUser = (username, token, role, mustChangePasswordFlag) => {
    setCharts([]);
    setDashboardsList([]);
    setCurrentDashboardId(null);
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
    const restrictedViews = ['configTurnos', 'configOee', 'configSensores', 'configPerdas'];
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
    pendingParadasCount,
    currentUser,
    onOpenUserModal: () => setIsUserModalOpen(true),
    onLogout: handleLogout,
  };

  if (currentView === 'relatorioExecutivo') {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <RelatorioExecutivoView onBack={() => setCurrentView('dashboard')} />
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

  if (currentView === 'perdas') {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <PerdasView
            onBack={() => setCurrentView('dashboard')}
            isMuted={isMuted}
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

  if (currentView === 'configPerdas' && canConfig) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <PerdasConfigView onBack={() => setCurrentView('dashboard')} />
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

  if (currentView === 'paradas') {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <ParadasView onBack={() => setCurrentView('dashboard')} canConfig={canConfig} />
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

  if (currentView === 'oee') {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <OeeView
            onBack={() => setCurrentView('dashboard')}
            onOpenConfig={() => setCurrentView('configTurnos')}
            onOpenOeeConfig={() => setCurrentView('configOee')}
            oeeData={oeeMetricsData}
            canConfig={canConfig}
            isAdmin={canManageUsers}
            onRefreshOee={fetchOeeMetricsFromDb}
            refreshInterval={oeeRefreshInterval}
            onRefreshIntervalChange={setOeeRefreshInterval}
            isMuted={isMuted}
            onAlarmChanged={fetchActiveAlarms}
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

  if (currentView === 'configOee' && canConfig) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex overflow-hidden">
        <Sidebar {...sidebarProps} />
        <div className="flex-1 overflow-hidden">
          <OeeConfigView onBack={() => setCurrentView('dashboard')} />
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
    if (!currentDashboardId) return;
    try {
      // Além de quais gráficos existem, salva também as preferências de
      // visualização (visibilidade de cada pena já vem dentro de cada
      // gráfico em "charts"; atualização e atalho de período são globais).
      // Sempre no dashboard atualmente aberto — nunca cria um novo aqui.
      const response = await api.put(`/api/dashboards/${currentDashboardId}`, { charts, refreshInterval, timeRange });

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

  // --- Troca / criação / renomeação / exclusão de dashboards ---
  const switchDashboard = async (id) => {
    if (id === currentDashboardId) {
      setIsDashboardPickerOpen(false);
      return;
    }
    // Mesma trava de loadInitialLayout: se o usuário logar/trocar de conta
    // enquanto essa troca de dashboard ainda está em voo, a resposta velha
    // não pode aplicar por cima dos dados da conta nova.
    const myGeneration = ++loadGenerationRef.current;
    setDashboardError('');
    try {
      const res = await api.get(`/api/dashboards/${id}`);
      if (myGeneration !== loadGenerationRef.current) return;
      if (isOk(res)) {
        const data = res.data;
        const normalizedCharts = (Array.isArray(data.charts) ? data.charts : []).map((c) => ({
          ...c,
          fields: Array.isArray(c.fields) ? c.fields : (c.field ? [c.field] : []),
          hiddenFields: Array.isArray(c.hiddenFields) ? c.hiddenFields : [],
        }));
        setCharts(normalizedCharts);
        if (data.refreshInterval !== undefined) setRefreshInterval(data.refreshInterval);
        if (data.timeRange) setTimeRange(data.timeRange);
        setCurrentDashboardId(id);
        localStorage.setItem(`lastDashboardId_${currentUser}`, String(id));
      } else {
        setDashboardError(res.data?.error || 'Erro ao abrir dashboard.');
      }
    } catch (err) {
      setDashboardError('Erro ao abrir dashboard.');
    }
    setIsDashboardPickerOpen(false);
  };

  const handleCreateDashboard = async () => {
    const name = newDashboardName.trim();
    if (!name) return;
    setDashboardError('');
    try {
      const res = await api.post('/api/dashboards', { name });
      if (isOk(res)) {
        const created = res.data;
        setDashboardsList((prev) => [...prev, { id: created.id, name: created.name, updatedAt: new Date().toISOString() }]);
        setCharts(Array.isArray(created.charts) ? created.charts : []);
        setRefreshInterval(created.refreshInterval ?? 5000);
        setTimeRange(created.timeRange || '24h');
        setCurrentDashboardId(created.id);
        localStorage.setItem(`lastDashboardId_${currentUser}`, String(created.id));
        setNewDashboardName('');
        setIsDashboardPickerOpen(false);
      } else {
        setDashboardError(res.data?.error || 'Erro ao criar dashboard.');
      }
    } catch (err) {
      setDashboardError('Erro ao criar dashboard.');
    }
  };

  const handleRenameDashboard = async () => {
    const name = renameValue.trim();
    if (!name || !currentDashboardId) return;
    setDashboardError('');
    try {
      const res = await api.put(`/api/dashboards/${currentDashboardId}`, { charts, refreshInterval, timeRange, name });
      if (isOk(res)) {
        setDashboardsList((prev) => prev.map((d) => (d.id === currentDashboardId ? { ...d, name } : d)));
        setRenamingDashboard(false);
      } else {
        setDashboardError(res.data?.error || 'Erro ao renomear dashboard.');
      }
    } catch (err) {
      setDashboardError('Erro ao renomear dashboard.');
    }
  };

  const handleDeleteDashboard = async (id) => {
    if (!window.confirm('Excluir este dashboard? Essa ação não pode ser desfeita.')) return;
    setDashboardError('');
    try {
      const res = await api.delete(`/api/dashboards/${id}`);
      if (isOk(res)) {
        const remaining = dashboardsList.filter((d) => d.id !== id);
        setDashboardsList(remaining);
        if (id === currentDashboardId && remaining.length > 0) {
          switchDashboard(remaining[0].id);
        }
      } else {
        setDashboardError(res.data?.error || 'Erro ao excluir dashboard.');
      }
    } catch (err) {
      setDashboardError('Erro ao excluir dashboard.');
    }
  };

  const currentDashboardName = dashboardsList.find((d) => d.id === currentDashboardId)?.name || 'Dashboard';

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
          <div className="relative">
            {renamingDashboard ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameDashboard();
                    if (e.key === 'Escape') setRenamingDashboard(false);
                  }}
                  maxLength={80}
                  className="bg-slate-800 border border-amber-500 rounded px-2 py-1 text-xl font-bold text-amber-500 focus:outline-none"
                />
                <button type="button" onClick={handleRenameDashboard} className="text-emerald-400 hover:text-emerald-300 p-1" title="Confirmar">
                  <Check size={18} />
                </button>
                <button type="button" onClick={() => setRenamingDashboard(false)} className="text-slate-400 hover:text-white p-1" title="Cancelar">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsDashboardPickerOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-xl font-bold text-amber-500 hover:text-amber-400 transition"
                title="Trocar de dashboard"
              >
                <LayoutGrid size={18} />
                {currentDashboardName}
                <ChevronDown size={16} className={`transition-transform ${isDashboardPickerOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
            <p className="text-slate-400 text-xs">
              Monitoramento de sensores e variáveis historizadas em tempo real
            </p>

            {isDashboardPickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl w-72 flex flex-col p-2">
                <p className="text-[10px] text-slate-400 px-1.5 pb-1 uppercase font-semibold">Seus dashboards</p>

                {dashboardError && (
                  <div className="flex items-center gap-1.5 bg-red-900/40 border border-red-700 text-red-200 text-[11px] rounded px-2 py-1.5 mb-1.5">
                    <span className="flex-1">{dashboardError}</span>
                    <button type="button" onClick={() => setDashboardError('')} className="text-red-300 hover:text-white shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-1 max-h-56 overflow-y-auto mb-2">
                  {dashboardsList.map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-1 rounded-lg ${
                        d.id === currentDashboardId ? 'bg-amber-600/20 border border-amber-500/40' : 'hover:bg-slate-700/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => switchDashboard(d.id)}
                        className={`flex-1 text-left px-2.5 py-1.5 text-xs truncate ${
                          d.id === currentDashboardId ? 'text-amber-300 font-semibold' : 'text-slate-200'
                        }`}
                      >
                        {d.name}
                      </button>
                      {d.id === currentDashboardId && (
                        <button
                          type="button"
                          title="Renomear"
                          onClick={() => {
                            setRenameValue(d.name);
                            setRenamingDashboard(true);
                            setIsDashboardPickerOpen(false);
                          }}
                          className="p-1.5 text-slate-400 hover:text-amber-400"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {dashboardsList.length > 1 && (
                        <button
                          type="button"
                          title="Excluir"
                          onClick={() => handleDeleteDashboard(d.id)}
                          className="p-1.5 mr-0.5 text-slate-400 hover:text-red-400"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-700 pt-2 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newDashboardName}
                    onChange={(e) => setNewDashboardName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateDashboard(); }}
                    placeholder="Nome do novo dashboard"
                    maxLength={80}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={handleCreateDashboard}
                    disabled={!newDashboardName.trim()}
                    className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold px-2 py-1.5 rounded transition"
                  >
                    <Plus size={13} /> Criar
                  </button>
                </div>
              </div>
            )}
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
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none font-mono w-[140px] shrink-0 justify-between"
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
          <span className="text-slate-400 flex items-center gap-1 font-semibold uppercase">
            <Clock size={13} /> Padrão: últimas 24h
          </span>

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