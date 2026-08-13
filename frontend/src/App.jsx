import React, { useState, useEffect } from 'react';
import { Plus, Clock, RefreshCw, Save, Check, LogOut, User, Calendar, X, Bell, Maximize, Minimize, Volume2, VolumeX, Gauge, Settings, Sliders } from 'lucide-react';
import ChartCard from './ChartCard';
import Login from './Login';
import AlarmModal from './AlarmModal';
import OeeView from './OeeView';
import ConfigView from './ConfigView';
import SensorConfigView from './SensorConfigView';

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
  const [sensorConfigs, setSensorConfigs] = useState({});
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

  const [currentView, setCurrentView] = useState('dashboard');

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
    const interval = setInterval(fetchOeeMetricsFromDb, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadInitialLayout = async () => {
    try {
      let configs = {};
      try {
        const configRes = await fetch('http://192.168.15.108:5000/api/config/sensores');
        if (configRes.ok) {
          configs = await configRes.json();
          setSensorConfigs(configs);
        }
      } catch (err) {
        console.error('Erro ao buscar configs de sensores:', err);
      }

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

  if (currentView === 'oee') {
    return (
      <OeeView
        onBack={() => setCurrentView('dashboard')}
        onOpenConfig={() => setCurrentView('configTurnos')}
        oeeData={oeeMetricsData}
      />
    );
  }

  if (currentView === 'configTurnos') {
    return <ConfigView onBack={() => setCurrentView('dashboard')} />;
  }

  if (currentView === 'configSensores') {
    return (
      <SensorConfigView 
        onBack={() => {
          setCurrentView('dashboard');
          loadInitialLayout();
        }} 
      />
    );
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

    if (charts.some((c) => c.field === selectedField)) {
      alert("Este sensor já está sendo exibido na tela!");
      return;
    }

    const friendlyName = sensorConfigs[selectedField]?.descricao || `Sensor - ${selectedField}`;
    const newChart = {
      id: Date.now().toString(),
      title: friendlyName,
      field: selectedField,
      minLimit: sensorConfigs[selectedField]?.minLimit ?? 100,
      maxLimit: sensorConfigs[selectedField]?.maxLimit ?? 800
    };

    setCharts([...charts, newChart]);
  };

  const handleRemoveChart = (id) => {
    setCharts(charts.filter((chart) => chart.id !== id));
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

            <button
              onClick={() => setCurrentView('configTurnos')}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
            >
              <Settings size={14} className="text-amber-400" /> Turnos
            </button>

            <button
              onClick={() => setCurrentView('configSensores')}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold transition shadow-md"
            >
              <Sliders size={14} className="text-amber-400" /> Variáveis
            </button>

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
              onClick={() => setIsAlarmModalOpen(true)}
              className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-xs font-semibold transition ${
                activeAlertsCount > 0
                  ? 'bg-red-600 text-white border-red-500 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-red-400 border-slate-700'
              }`}
            >
              <Bell size={14} /> Alarmes {activeAlertsCount > 0 && `(${activeAlertsCount})`}
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

            <form onSubmit={handleAddChart} className="flex gap-1.5">
              <select
                value={selectedField}
                onChange={(e) => setSelectedField(e.target.value)}
                className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none font-mono"
              >
                {availableFields.map((field) => {
                  const friendlyDesc = sensorConfigs[field]?.descricao;
                  return (
                    <option key={field} value={field}>
                      {friendlyDesc ? `${friendlyDesc} (${field})` : field}
                    </option>
                  );
                })}
              </select>

              <button
                type="submit"
                className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1 rounded text-xs font-medium"
              >
                <Plus size={14} /> Adicionar
              </button>
            </form>

            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded pl-2 pr-1 py-1">
              <div className="flex items-center gap-1 text-xs text-slate-300">
                <User size={13} className="text-amber-500" />
                <span className="font-medium max-w-[80px] truncate" title={currentUser}>
                  {currentUser}
                </span>
              </div>
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
              onAlertStatusChange={handleAlertStatusChange}
              isMuted={isMuted}
            />
          </div>
        ))}
      </div>

      <AlarmModal
        isOpen={isAlarmModalOpen}
        onClose={() => setIsAlarmModalOpen(false)}
      />
    </div>
  );
}