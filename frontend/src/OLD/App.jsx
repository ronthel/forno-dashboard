import React, { useState, useEffect } from 'react';
import { Plus, Clock, RefreshCw, Save, Check, LogOut, User, Calendar, X, Bell, Maximize, Minimize, Volume2, VolumeX, Gauge } from 'lucide-react';
import ChartCard from './ChartCard';
import Login from './Login';
import AlarmModal from './AlarmModal';
import KpiPanel from './KpiPanel';
import OeeView from './OeeView';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('isLoggedIn') === 'true';
  });

  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('currentUser') || 'Operador';
  });

  const [isServerDown, setIsServerDown] = useState(false);
  const [wasServerDown, setWasServerDown] = useState(false);

  const [charts, setCharts] = useState([]);
  const [availableFields, setAvailableFields] = useState([]);
  const [selectedField, setSelectedField] = useState('');
  
  const [timeRange, setTimeRange] = useState('1h');
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customDates, setCustomDates] = useState(null);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isAlarmModalOpen, setIsAlarmModalOpen] = useState(false);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Estado para alternar entre o Dashboard de Variáveis e a Tela de OEE
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard' ou 'oee'

  // Estados para armazenar as métricas reais de OEE vindas do InfluxDB/Backend
  const [oeeMetricsData, setOeeMetricsData] = useState({
    runTimeSec: 0,
    totalCount: 0,
    goodCount: 0
  });

  const [activeAlertsMap, setActiveAlertsMap] = useState({});

  const handleAlertStatusChange = (chartId, isAlert) => {
    setActiveAlertsMap((prev) => {
      if (prev[chartId] === isAlert) return prev;
      return { ...prev, [chartId]: isAlert };
    });
  };

  const activeAlertsCount = Object.values(activeAlertsMap).filter(Boolean).length;
  const [uptimePercentage, setUptimePercentage] = useState(98.5);

  useEffect(() => {
    const interval = setInterval(() => {
      const base = 98 + Math.random();
      setUptimePercentage(base.toFixed(1));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Função para buscar os dados reais de OEE do backend/InfluxDB
  const fetchOeeMetricsFromDb = async () => {
    try {
      const res = await fetch('http://192.168.15.108:5000/api/oee/metrics');
      if (res.ok) {
        const data = await res.json();
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
    const interval = setInterval(fetchOeeMetricsFromDb, 10000); // Atualiza a cada 10s
    return () => clearInterval(interval);
  }, []);

  const loadInitialLayout = async () => {
    try {
      const res = await fetch('http://192.168.15.108:5000/api/dashboard/layout');
      if (res.ok) {
        const savedCharts = await res.json();
        if (Array.isArray(savedCharts) && savedCharts.length > 0) {
          setCharts(savedCharts);
        } else {
          setCharts([
            { id: '1', title: 'Sensor - CTP01', field: 'CTP01', minLimit: 100, maxLimit: 800 },
            { id: '2', title: 'Sensor - CTP02', field: 'CTP02', minLimit: 100, maxLimit: 800 }
          ]);
        }
      }

      const fieldsRes = await fetch('http://192.168.15.108:5000/api/influx/fields');
      if (fieldsRes.ok) {
        const fieldsData = await fieldsRes.json();
        if (Array.isArray(fieldsData) && fieldsData.length > 0) {
          setAvailableFields(fieldsData);
          setSelectedField(fieldsData[0]);
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

  const handleLoginSuccess = (username) => {
    const userToSave = username || 'Operador';
    setIsAuthenticated(true);
    setCurrentUser(userToSave);
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('currentUser', userToSave);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentUser');
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

  const handleUpdateChartLimits = (chartId, minLimit, maxLimit) => {
    setCharts((prevCharts) =>
      prevCharts.map((c) =>
        c.id === chartId ? { ...c, minLimit, maxLimit } : c
      )
    );
  };

  if (!isAuthenticated || isServerDown) {
    return (
      <Login
        onLoginSuccess={handleLoginSuccess}
        isServerDown={isServerDown}
      />
    );
  }

  // Se o operador clicou para ver o OEE, renderiza a tela dedicada passando os dados reais do banco
  if (currentView === 'oee') {
    return <OeeView onBack={() => setCurrentView('dashboard')} oeeData={oeeMetricsData} />;
  }

  const handleSaveLayout = async () => {
    try {
      const response = await fetch('http://192.168.15.108:5000/api/dashboard/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charts })
      });

      if (response.ok) {
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
    if (!selectedField) return;

    const newChart = {
      id: Date.now().toString(),
      title: `Sensor - ${selectedField}`,
      field: selectedField,
      minLimit: 100,
      maxLimit: 800
    };

    setCharts([...charts, newChart]);
  };

  const handleRemoveChart = (id) => {
    setCharts(charts.filter((chart) => chart.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <header className="flex flex-col gap-4 mb-6 border-b border-slate-800 pb-4">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-amber-500">
              Dashboard - Forno Industrial
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Monitoramento de sensores e variáveis historizadas em tempo real
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            {/* Botão de Acesso ao Relatório de OEE */}
            <button
              onClick={() => setCurrentView('oee')}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-semibold transition shadow-md"
              title="Abrir Painel de Eficiência OEE"
            >
              <Gauge size={14} /> Relatório OEE
            </button>

            {/* Som Mute */}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`flex items-center gap-1.5 border px-3 py-1.5 rounded text-xs font-semibold transition ${
                isMuted
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/30'
              }`}
            >
              {isMuted ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} />}
              {isMuted ? 'Som Desativado' : 'Som Ativo'}
            </button>

            {/* Modo TV */}
            <button
              onClick={toggleKioskMode}
              className={`flex items-center gap-1.5 border px-3 py-1.5 rounded text-xs font-semibold transition ${
                isKioskMode
                  ? 'bg-amber-600 text-white border-amber-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              {isKioskMode ? <Minimize size={14} /> : <Maximize size={14} />}
              {isKioskMode ? 'Sair do Modo TV' : 'Modo TV'}
            </button>

            {/* Alarmes */}
            <button
              onClick={() => setIsAlarmModalOpen(true)}
              className={`flex items-center gap-1.5 border px-3 py-1.5 rounded text-xs font-semibold transition ${
                activeAlertsCount > 0
                  ? 'bg-red-600 text-white border-red-500 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-red-400 border-slate-700'
              }`}
            >
              <Bell size={14} /> Alarmes {activeAlertsCount > 0 && `(${activeAlertsCount})`}
            </button>

            {/* Salvar Dashboard */}
            <button
              onClick={handleSaveLayout}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition ${
                savedSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700'
              }`}
            >
              {savedSuccess ? <Check size={14} /> : <Save size={14} />}
              {savedSuccess ? 'Salvo!' : 'Salvar Dashboard'}
            </button>

            {/* Auto-Refresh */}
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1.5">
              <RefreshCw size={14} className={`text-amber-500 ${refreshInterval > 0 && !customDates ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
              <select
                value={refreshInterval}
                disabled={!!customDates}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="bg-slate-900 text-slate-200 text-xs rounded border border-slate-700 px-2 py-1 focus:outline-none disabled:opacity-50"
              >
                <option value={5000}>a cada 5s</option>
                <option value={15000}>a cada 15s</option>
                <option value={30000}>a cada 30s</option>
                <option value={0}>Off</option>
              </select>
            </div>

            {/* Adicionar Gráfico */}
            <form onSubmit={handleAddChart} className="flex gap-2">
              <select
                value={selectedField}
                onChange={(e) => setSelectedField(e.target.value)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm focus:outline-none"
              >
                {availableFields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-sm font-medium"
              >
                <Plus size={16} /> Adicionar
              </button>
            </form>

            {/* Logout */}
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded pl-2.5 pr-1 py-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <User size={14} className="text-amber-500" />
                <span className="font-medium max-w-[100px] truncate" title={currentUser}>
                  {currentUser}
                </span>
              </div>

              <button
                onClick={handleLogout}
                title="Sair / Trocar Usuário"
                className="flex items-center gap-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white px-2 py-1 rounded text-xs font-medium transition border border-red-500/30 hover:border-red-600"
              >
                <LogOut size={13} /> Sair
              </button>
            </div>
          </div>
        </div>

        {/* Atalhos de tempo e Período */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-950/40 p-2.5 rounded border border-slate-800">
          <div className="flex items-center gap-1">
            <span className="text-slate-400 pr-1 flex items-center gap-1 text-xs font-semibold uppercase">
              <Clock size={14} /> Atalhos:
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
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  timeRange === btn.value && !customDates
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleApplyCustomDates} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold uppercase flex items-center gap-1">
              <Calendar size={14} /> Período Específico:
            </span>

            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-amber-500"
              required
            />

            <span className="text-slate-500">até</span>

            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-amber-500"
              required
            />

            <button
              type="submit"
              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded font-medium transition"
            >
              Filtrar
            </button>

            {customDates && (
              <button
                type="button"
                onClick={handleClearCustomDates}
                title="Limpar filtro de data"
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition border border-slate-700"
              >
                <X size={13} /> Limpar
              </button>
            )}
          </form>
        </div>
      </header>

      {/* Painel KPI Principal */}
      <KpiPanel charts={charts} activeAlertsCount={activeAlertsCount} uptimePercentage={uptimePercentage} />

      {/* Grid de Gráficos (Dashboard de Variáveis Original Preservado) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {charts.map((chart) => (
          <ChartCard
            key={chart.id}
            chart={chart}
            timeRange={timeRange}
            customDates={customDates}
            refreshInterval={refreshInterval}
            onRemove={handleRemoveChart}
            onUpdateLimits={handleUpdateChartLimits}
            onAlertStatusChange={handleAlertStatusChange}
            isMuted={isMuted}
          />
        ))}
      </div>

      <AlarmModal
        isOpen={isAlarmModalOpen}
        onClose={() => setIsAlarmModalOpen(false)}
      />
    </div>
  );
}