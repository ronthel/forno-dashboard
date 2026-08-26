import React, { useState, useEffect, useRef } from 'react';
import { Gauge, Activity, CheckCircle, Clock, Database, TrendingUp, Settings, RotateCcw, RefreshCw, Power, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import api, { isOk } from './api';
import ProductionTimeline from './ProductionTimeline';

const TURNO_KEYS = ['turnoA', 'turnoB', 'turnoC'];

// Limite de tempo parado, em segundos, a partir do qual disparamos o alarme
// visual + sonoro pedindo reconhecimento do operador.
const LIMITE_ALARME_PARADA_SEG = 60;
const ALARME_FIELD_NAME = 'Máquina Parada (OEE)';

const playAlarmSound = (isMuted) => {
  if (isMuted) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (err) { console.warn('Audio não permitido:', err); }
};

function formatarDuracao(totalSegundos) {
  const s = Math.max(0, Math.floor(totalSegundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const ZERO_TURNO = {
  nome: null, metaOee: 80, isAtual: false, plannedSeg: 0,
  runTimeSec: 0, totalCount: 0, refugoCount: 0, goodCount: 0,
  maquinaRodando: null, velocidadeInstantaneaPpm: null,
  elapsedMin: 0, expectedCount: 0, oeeSimplificado: 0
};

// Mesma fórmula usada pro turno atual (ver mais abaixo), aplicada a um ponto
// do histórico — mantém os dois cálculos sempre iguais, um só lugar de verdade.
function calcularOeePonto(ponto, velocidadeNominalPpm) {
  const availability = ponto.plannedSeg > 0 ? Math.min(100, (ponto.runTimeSec / ponto.plannedSeg) * 100) : 0;
  const velocidadeReaMediaPpm = ponto.runTimeSec > 0 ? (ponto.totalCount / (ponto.runTimeSec / 60)) : 0;
  const performance = velocidadeNominalPpm > 0 ? Math.min(100, (velocidadeReaMediaPpm / velocidadeNominalPpm) * 100) : 0;
  const quality = ponto.totalCount > 0 ? Math.min(100, (ponto.goodCount / ponto.totalCount) * 100) : 100;
  return Number(((availability * performance * quality) / 10000).toFixed(1));
}

export default function OeeView({ onBack, onOpenConfig, onOpenOeeConfig, oeeData, canConfig, isAdmin, onRefreshOee, refreshInterval, onRefreshIntervalChange, isMuted, onAlarmChanged }) {
  const [historyData, setHistoryData] = useState([]);
  // Janela do turno selecionado (início/fim PROGRAMADO, em ms) — define o
  // eixo X inteiro do gráfico de tendência, mesmo nos trechos onde ainda
  // não existe ponto (turno ainda não chegou lá).
  const [turnoJanela, setTurnoJanela] = useState({ inicio: null, fim: null });
  const [selectedTurno, setSelectedTurno] = useState('turnoB');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Relógio local só pra fazer o tempo "rodando/parada há X" andar em tempo
  // real na tela entre uma atualização e outra dos dados (que vêm do
  // servidor no ritmo de refreshInterval).
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const statusMaquina = oeeData?.statusMaquina || { rodando: null, desde: null };
  const desdeMs = statusMaquina.desde ? new Date(statusMaquina.desde).getTime() : null;
  const segundosNoEstadoAtual = desdeMs ? (agora - desdeMs) / 1000 : null;
  const paradaEmAlarme = statusMaquina.rodando === false && segundosNoEstadoAtual != null && segundosNoEstadoAtual >= LIMITE_ALARME_PARADA_SEG;

  // Dispara/normaliza o alarme genérico do sistema (mesmo usado pelos
  // gráficos) assim que a parada atual ultrapassa o limite — e resolve
  // automaticamente quando a máquina volta a rodar. Um ref evita reenviar o
  // "trigger" a cada atualização enquanto a parada continua aberta.
  const alarmDispatchedRef = useRef(false);
  useEffect(() => {
    if (paradaEmAlarme) {
      if (!alarmDispatchedRef.current) {
        playAlarmSound(isMuted);
        alarmDispatchedRef.current = true;
        api.post('/api/alarms/trigger', {
          fieldName: ALARME_FIELD_NAME,
          valueRead: Math.round(segundosNoEstadoAtual),
          limitType: 'MAX',
          limitValue: LIMITE_ALARME_PARADA_SEG
        }).then(() => onAlarmChanged?.()).catch((err) => console.error('Erro ao registrar alarme de máquina parada:', err));
      }
    } else if (alarmDispatchedRef.current) {
      alarmDispatchedRef.current = false;
      api.post('/api/alarms/resolve', { fieldName: ALARME_FIELD_NAME })
        .then(() => onAlarmChanged?.())
        .catch((err) => console.error('Erro ao normalizar alarme de máquina parada:', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paradaEmAlarme]);

  const isOeeConfigured = !!oeeData?.configured;
  const velocidadeNominalPpm = oeeData?.velocidadeNominalPpm || 50;
  const turnos = oeeData?.turnos || {};

  // Assim que os dados dos turnos chegam pela primeira vez, seleciona
  // automaticamente o que estiver rodando agora (isAtual) — só troca a
  // seleção sozinha nessa primeira vez, pra não tirar o usuário da aba que
  // ele escolheu olhar manualmente depois.
  useEffect(() => {
    const atual = TURNO_KEYS.find((k) => turnos[k]?.isAtual);
    if (atual) setSelectedTurno(atual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(turnos).length]);

  const turnoSelecionado = turnos[selectedTurno] || ZERO_TURNO;
  const metaAtual = turnoSelecionado.metaOee || 80;

  const runTimeSec = turnoSelecionado.runTimeSec || 0;
  const totalCount = turnoSelecionado.totalCount || 0;
  const refugoCount = turnoSelecionado.refugoCount || 0;
  const goodCount = turnoSelecionado.goodCount || 0;
  const plannedTimeSec = turnoSelecionado.plannedSeg || 28800;
  const velocidadeInstantaneaPpm = turnoSelecionado.velocidadeInstantaneaPpm;

  // OEE Acumulado "leitura direta" (Peças Boas ÷ Minutos decorridos ×
  // Velocidade Padrão) e Desempenho Instantâneo (Velocidade Atual ÷
  // Velocidade Padrão) — indicadores adicionais, mais diretos pro operador,
  // que vêm prontos do backend / são derivados aqui. Não substituem o OEE
  // Consolidado (anel abaixo), que continua sendo o cálculo A×P×Q oficial.
  const elapsedMin = turnoSelecionado.elapsedMin || 0;
  const expectedCount = turnoSelecionado.expectedCount || 0;
  const oeeSimplificado = turnoSelecionado.oeeSimplificado || 0;
  const desempenhoInstantaneoPct = velocidadeInstantaneaPpm != null && velocidadeNominalPpm > 0
    ? Math.min(100, (velocidadeInstantaneaPpm / velocidadeNominalPpm) * 100)
    : null;

  // Cálculo do turno selecionado
  const availability = plannedTimeSec > 0 ? Math.min(100, (runTimeSec / plannedTimeSec) * 100) : 0;
  // Performance em pacotes/minuto: velocidade real média (contagem total
  // dividida pelo tempo rodando, não pelo tempo total do turno — isola a
  // perda de velocidade da perda de disponibilidade, que já é contada à
  // parte) sobre a velocidade nominal da linha.
  const velocidadeReaMediaPpm = runTimeSec > 0 ? (totalCount / (runTimeSec / 60)) : 0;
  const performance = velocidadeNominalPpm > 0 ? Math.min(100, (velocidadeReaMediaPpm / velocidadeNominalPpm) * 100) : 0;
  const quality = totalCount > 0 ? Math.min(100, (goodCount / totalCount) * 100) : 100;
  const oeeAtual = (availability * performance * quality) / 10000;

  const turnoLabel = (key) => {
    const t = turnos[key];
    if (!t?.nome) return key === 'turnoA' ? 'Turno A' : key === 'turnoB' ? 'Turno B' : 'Turno C';
    return t.isAtual ? `${t.nome} (Atual)` : t.nome;
  };

  const currentMetrics = {
    availability, performance, quality, oee: oeeAtual,
    label: turnoLabel(selectedTurno)
  };

  const getOeeColor = (val, meta) => {
    if (val < meta - 20) return '#ef4444';
    if (val < meta) return '#eab308';
    return '#22c55e';
  };

  // Gráfico de tendência DENTRO do turno selecionado: OEE acumulado desde o
  // início até o horário final programado do turno — mostra a evolução do
  // operador ao longo do próprio turno, não a comparação com outros dias.
  // Reconsulta periodicamente pra a curva ir andando junto com o turno.
  useEffect(() => {
    let cancelado = false;
    const fetchTendencia = () => {
      api.get('/api/oee/tendencia-turno', { params: { turnoKey: selectedTurno } })
        .then((res) => {
          if (cancelado || !isOk(res)) return;
          const data = res.data || {};
          const nominal = data.velocidadeNominalPpm || velocidadeNominalPpm;
          const pontos = (data.pontos || []).map((p) => ({
            tempoMs: p.tempoMs,
            time: p.label,
            oee: calcularOeePonto(p, nominal)
          }));
          setHistoryData(pontos);
          setTurnoJanela({
            inicio: data.inicio ? new Date(data.inicio).getTime() : null,
            fim: data.fimProgramado ? new Date(data.fimProgramado).getTime() : null
          });
        })
        .catch((err) => console.error('Erro ao buscar tendência do turno:', err));
    };
    fetchTendencia();
    const interval = setInterval(fetchTendencia, 30000);
    return () => { cancelado = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTurno]);

  // Linha do tempo visual (verde produzindo / vermelho parado) do turno
  // selecionado — reaproveita os mesmos registros de `paradas` já usados na
  // tela de Paradas. Reconsulta junto com a tendência, mesmo ritmo.
  const [timelineBlocos, setTimelineBlocos] = useState([]);
  const [timelineJanela, setTimelineJanela] = useState({ inicio: null, fimProgramado: null });
  useEffect(() => {
    let cancelado = false;
    const fetchTimeline = () => {
      api.get('/api/oee/timeline', { params: { turnoKey: selectedTurno } })
        .then((res) => {
          if (cancelado || !isOk(res)) return;
          setTimelineBlocos(res.data?.blocos || []);
          setTimelineJanela({ inicio: res.data?.inicio || null, fimProgramado: res.data?.fimProgramado || null });
        })
        .catch((err) => console.error('Erro ao buscar linha do tempo do turno:', err));
    };
    fetchTimeline();
    const interval = setInterval(fetchTimeline, 30000);
    return () => { cancelado = true; clearInterval(interval); };
  }, [selectedTurno]);

  const r1 = 85;
  const c1 = 2 * Math.PI * r1;
  const stroke1 = c1 - (currentMetrics.availability / 100) * c1;

  const r2 = 68;
  const c2 = 2 * Math.PI * r2;
  const stroke2 = c2 - (currentMetrics.performance / 100) * c2;

  const r3 = 51;
  const c3 = 2 * Math.PI * r3;
  const stroke3 = c3 - (currentMetrics.quality / 100) * c3;

  const handleReset = async () => {
    if (!window.confirm(`Zerar os contadores do OEE do turno atual (${currentMetrics.label}) a partir de agora? Isso não muda nada no CLP — só marca este instante como novo ponto de partida pros cálculos desse turno. Os outros turnos e o gráfico de tendência não são afetados.`)) return;
    setResetting(true);
    setResetError('');
    try {
      const res = await api.post('/api/oee/reset');
      if (isOk(res)) {
        if (onRefreshOee) await onRefreshOee();
      } else {
        setResetError(res.data?.error || 'Erro ao zerar: sem permissão ou sessão expirada.');
      }
    } catch (err) {
      setResetError('Erro ao zerar contadores do OEE.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-2 flex flex-col gap-1.5 overflow-y-auto">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-base font-bold text-amber-500 flex items-center gap-1.5">
              <Gauge size={18} /> Relatório de OEE por Turno (Meta: {metaAtual}%)
            </h1>
            <p className="text-slate-400 text-[11px]">Monitoramento gerencial e tendência da linha de produção</p>
          </div>
        </div>

        {/* Grupo Central: Seletor de Turnos + Botões */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 p-1 rounded-lg">
            <span className="text-slate-400 text-xs px-2 font-semibold">TURNO:</span>
            {TURNO_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedTurno(key)}
                className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                  selectedTurno === key ? 'bg-amber-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                {turnos[key]?.isAtual && (
                  <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" title="Rodando agora" />
                )}
                {turnos[key]?.nome || (key === 'turnoA' ? 'Turno A' : key === 'turnoB' ? 'Turno B' : 'Turno C')}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-2 py-1 gap-1">
            <RefreshCw size={14} className={`text-amber-500 ${refreshInterval > 0 ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            <select
              value={refreshInterval}
              onChange={(e) => onRefreshIntervalChange?.(Number(e.target.value))}
              className="bg-slate-900 text-slate-200 text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none"
              title="Frequência de atualização automática"
            >
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={0}>Off</option>
            </select>
          </div>

          {isAdmin && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-red-900/60 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow disabled:opacity-50"
              title="Zerar os contadores do OEE do turno atual a partir de agora"
            >
              <RotateCcw size={14} /> {resetting ? 'Zerando…' : 'Zerar'}
            </button>
          )}

          {canConfig && (
            <button
              onClick={onOpenConfig}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
              title="Configurar Horários e Metas"
            >
              <Settings size={16} /> Configurar
            </button>
          )}
        </div>

        {/* Variáveis Brutas PLC */}
        <div className="flex items-center gap-3 text-xs font-mono bg-slate-800/80 border border-slate-700 px-3 py-1 rounded-lg shadow">
          <span className="text-amber-400 flex items-center gap-1 font-semibold"><Database size={13} /> PLC:</span>
          <span className="text-slate-300">RUN: <strong className="text-blue-400">{runTimeSec}s</strong></span>
          <span className="text-slate-300">TOT: <strong className="text-amber-400">{totalCount}</strong></span>
          <span className="text-slate-300">BOAS: <strong className="text-emerald-400">{goodCount}</strong></span>
          <span className="text-slate-300">REFUGO: <strong className="text-red-400">{refugoCount}</strong></span>
          {velocidadeInstantaneaPpm != null && (
            <span className="text-slate-300">
              VELOCIDADE: <strong className="text-sky-400">{velocidadeInstantaneaPpm.toFixed(0)} pct/min</strong>
            </span>
          )}
          <span className="text-slate-300">
            NOMINAL: <strong className="text-violet-400">{velocidadeNominalPpm} pct/min</strong>
          </span>
        </div>
      </div>

      {/* Status da Máquina — verde rodando / vermelho parada, com tempo no
          estado atual. Pisca e vira alerta quando a parada passa de 1 minuto,
          exigindo reconhecimento do operador na tela de Alarmes. */}
      {statusMaquina.rodando !== null && (
        <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-1.5 border shadow-md ${
          statusMaquina.rodando
            ? 'bg-emerald-950/40 border-emerald-700'
            : paradaEmAlarme
            ? 'bg-red-950/60 border-red-600 animate-pulse'
            : 'bg-slate-800/90 border-slate-700'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`size-3 rounded-full shrink-0 ${
              statusMaquina.rodando ? 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]' : 'bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.6)]'
            } ${!statusMaquina.rodando ? 'animate-pulse' : ''}`} />
            <Power size={15} className={statusMaquina.rodando ? 'text-emerald-400' : 'text-red-400'} />
            <span className={`text-xs font-bold uppercase tracking-wide ${statusMaquina.rodando ? 'text-emerald-300' : 'text-red-300'}`}>
              {statusMaquina.rodando ? 'Máquina Rodando' : 'Máquina Parada'}
            </span>
            <span className="text-slate-300 text-xs font-mono">
              {segundosNoEstadoAtual != null
                ? `há ${formatarDuracao(segundosNoEstadoAtual)}`
                : 'desde o início do monitoramento'}
            </span>
          </div>

          {paradaEmAlarme && (
            <div className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">
              <AlertTriangle size={14} />
              Parada acima de {LIMITE_ALARME_PARADA_SEG}s — reconheça em Alarmes
            </div>
          )}
        </div>
      )}

      {resetError && (
        <div className="bg-red-950/40 border border-red-700 text-red-200 text-xs rounded-lg px-3 py-1.5">
          {resetError}
        </div>
      )}

      {!isOeeConfigured && (
        <div className="bg-amber-950/40 border border-amber-700 text-amber-200 text-xs rounded-lg px-3 py-1.5 flex items-center justify-between gap-3">
          <span>
            O cálculo do OEE ainda não está ligado a nenhuma variável real — os números abaixo estão zerados.
            {canConfig ? ' Configure o mapeamento das variáveis em "Parâmetros OEE".' : ' Peça pra um supervisor/administrador configurar em "Parâmetros OEE".'}
          </span>
          {canConfig && (
            <button
              onClick={onOpenOeeConfig}
              className="shrink-0 flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition"
            >
              <Settings size={14} /> Configurar agora
            </button>
          )}
        </div>
      )}

      {isOeeConfigured && TURNO_KEYS.every((k) => !turnos[k]) && (
        <div className="bg-amber-950/40 border border-amber-700 text-amber-200 text-xs rounded-lg px-3 py-1.5">
          Nenhum turno foi salvo ainda em "Turnos" → Parâmetros Operacionais por Turno — sem isso, não dá pra saber
          o horário/duração de cada turno pra calcular a Disponibilidade.
        </div>
      )}

      {/* Seção Central */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">

        {/* Coluna Esquerda: Cards de Métricas — grade 2x2 (em vez de 4
            empilhados) pra caber na altura da tela sem cortar nada embaixo. */}
        <div className="lg:col-span-4 grid grid-cols-2 gap-2">
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[10px] font-semibold uppercase leading-tight block">Disponibilidade</span>
              <h2 className="text-lg font-bold text-emerald-400 font-mono mt-0.5">{currentMetrics.availability.toFixed(1)}%</h2>
            </div>
            <Activity className="text-emerald-400 bg-emerald-950/40 p-1 rounded-lg border border-emerald-500/20 shrink-0 ml-1" size={20} />
          </div>

          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2 shadow-md flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-[10px] font-semibold uppercase leading-tight block">Qualidade</span>
              <h2 className="text-lg font-bold text-orange-400 font-mono mt-0.5">{currentMetrics.quality.toFixed(1)}%</h2>
            </div>
            <CheckCircle className="text-orange-400 bg-orange-950/40 p-1 rounded-lg border border-orange-500/20 shrink-0 ml-1" size={20} />
          </div>

          <div className="col-span-2 bg-slate-800/90 border border-slate-700 rounded-xl p-2 shadow-md flex items-center justify-between">
            <div className="flex-1">
              <span className="text-slate-400 text-[10px] font-semibold uppercase leading-tight block">Performance</span>
              <h2 className="text-lg font-bold text-amber-400 font-mono mt-0.5">{currentMetrics.performance.toFixed(1)}%</h2>
              {turnoSelecionado.isAtual && velocidadeInstantaneaPpm != null && (
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="h-1.5 flex-1 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                    <div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${desempenhoInstantaneoPct || 0}%` }} />
                  </div>
                  <span className="text-[10px] text-sky-400 font-mono font-bold shrink-0" title={`Desempenho instantâneo: ${velocidadeInstantaneaPpm.toFixed(0)} de ${velocidadeNominalPpm} pct/min`}>
                    {desempenhoInstantaneoPct != null ? desempenhoInstantaneoPct.toFixed(0) : '—'}%
                  </span>
                </div>
              )}
            </div>
            <Clock className="text-amber-400 bg-amber-950/40 p-1 rounded-lg border border-amber-500/20 shrink-0 ml-2" size={20} />
          </div>

          {/* OEE Acumulado — leitura direta: Peças Boas ÷ (Minutos decorridos ×
              Velocidade Padrão). Indicador extra, mais fácil de explicar pro
              operador; o OEE Consolidado (anel ao lado) continua sendo o
              cálculo oficial A×P×Q, sem mudança. */}
          <div className={`col-span-2 border rounded-xl p-2 shadow-md flex items-center justify-between ${
            oeeSimplificado >= metaAtual ? 'bg-emerald-950/40 border-emerald-700' : 'bg-red-950/40 border-red-700'
          }`}>
            <div>
              <span className="text-slate-400 text-[10px] font-semibold uppercase leading-tight block">OEE Acumulado — Leitura Direta</span>
              <h2 className={`text-lg font-bold font-mono mt-0.5 ${oeeSimplificado >= metaAtual ? 'text-emerald-400' : 'text-red-400'}`}>
                {oeeSimplificado.toFixed(0)}%
              </h2>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {goodCount} boas de {expectedCount} esperadas em {elapsedMin.toFixed(0)} min
              </p>
            </div>
            {oeeSimplificado >= metaAtual
              ? <CheckCircle className="text-emerald-400 bg-emerald-950/40 p-1 rounded-lg border border-emerald-500/20 shrink-0 ml-2" size={20} />
              : <AlertTriangle className="text-red-400 bg-red-950/40 p-1 rounded-lg border border-red-500/20 shrink-0 ml-2" size={20} />}
          </div>
        </div>

        {/* Coluna Direita: OEE Consolidado — só o mostrador, grande e
            centralizado no quadrado dele, sem texto ao lado (os anéis já
            usam as mesmas cores dos cards de Disponibilidade/Performance/
            Qualidade à esquerda, que têm os rótulos). */}
        <div className="lg:col-span-8 bg-slate-800/90 border border-slate-700 rounded-xl p-2 shadow-md flex items-center justify-center">
          <div className="relative w-44 h-44 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r={r1} fill="none" stroke="#1e293b" strokeWidth="13" />
              <circle cx="100" cy="100" r={r1} fill="none" stroke="#22c55e" strokeWidth="13"
                strokeDasharray={c1} strokeDashoffset={stroke1} strokeLinecap="round" className="transition-all duration-700" />

              <circle cx="100" cy="100" r={r2} fill="none" stroke="#1e293b" strokeWidth="13" />
              <circle cx="100" cy="100" r={r2} fill="none" stroke="#eab308" strokeWidth="13"
                strokeDasharray={c2} strokeDashoffset={stroke2} strokeLinecap="round" className="transition-all duration-700" />

              <circle cx="100" cy="100" r={r3} fill="none" stroke="#1e293b" strokeWidth="13" />
              <circle cx="100" cy="100" r={r3} fill="none" stroke="#f97316" strokeWidth="13"
                strokeDasharray={c3} strokeDashoffset={stroke3} strokeLinecap="round" className="transition-all duration-700" />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-4xl font-extrabold font-mono tracking-tight" style={{ color: getOeeColor(currentMetrics.oee, metaAtual) }}>
                {currentMetrics.oee.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Gráfico de Tendência */}
      <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2 shadow-md">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp size={13} className="text-amber-400" /> Evolução do OEE no Turno ({currentMetrics.label}) - Meta: {metaAtual}%
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">Atual: <strong className="text-amber-400">{currentMetrics.oee.toFixed(1)}%</strong></span>
        </div>

        <div style={{ width: '100%', height: '90px' }} className="bg-slate-900/70 p-1.5 rounded-lg border border-slate-700/60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData} margin={{ top: 5, right: 15, left: -20, bottom: -5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="tempoMs"
                type="number"
                scale="time"
                domain={turnoJanela.inicio != null && turnoJanela.fim != null ? [turnoJanela.inicio, turnoJanela.fim] : ['dataMin', 'dataMax']}
                tickFormatter={(ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                stroke="#94a3b8" tick={{ fontSize: 10 }}
              />
              <YAxis domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9', borderRadius: '6px', fontSize: '11px' }}
                itemStyle={{ color: '#38bdf8' }}
              />
              <ReferenceLine y={metaAtual} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Meta ${metaAtual}%`, fill: '#ef4444', fontSize: 10, position: 'top' }} />

              <Line type="monotone" dataKey="oee" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3, fill: '#38bdf8' }} activeDot={{ r: 5 }} name="OEE Global (janela de 15min)" connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Linha do Tempo de Produção — a barra representa o turno inteiro,
            da esquerda (início) pra direita (fim programado); vai enchendo
            de verde/vermelho conforme o tempo passa. Passe o mouse num
            bloco pra ver o horário e a duração exata dele; os totais do
            turno já aparecem embaixo da barra, sem precisar passar o mouse. */}
        <div className="mt-1 mb-0.5">
          <h3 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <Clock size={12} className="text-amber-400" /> Linha do Tempo de Produção ({currentMetrics.label})
          </h3>
        </div>
        <ProductionTimeline blocos={timelineBlocos} inicio={timelineJanela.inicio} fimProgramado={timelineJanela.fimProgramado} />
      </div>
    </div>
  );
}
