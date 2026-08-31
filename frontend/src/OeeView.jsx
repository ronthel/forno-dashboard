import React, { useState, useEffect, useRef } from 'react';
import { Gauge, Clock, Database, TrendingUp, Settings, RotateCcw, RefreshCw, Power, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import api, { isOk } from './api';
import ProductionTimeline from './ProductionTimeline';
import { calcularMetricasOee } from './oeeCalc';
import { OeeRingGauge, HalfDonutGauge } from './Gauges';
import InfoTooltip from './InfoTooltip';

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
  const velocidadeInstantaneaPpm = turnoSelecionado.velocidadeInstantaneaPpm;

  // Cálculo do turno selecionado — sempre pela MESMA fórmula usada no
  // gráfico de tendência e no Relatório Executivo (calcularMetricasOee, em
  // oeeCalc.js). Antes essa conta vinha duplicada aqui manualmente, o que
  // já violava o aviso lá em cima do arquivo ("nunca duplicar essa conta")
  // e foi exatamente o que deixou a tela e o gráfico divergir num detalhe
  // (Qualidade = 100% default durante parada, só corrigido lá).
  const { availability, performance, quality, oee: oeeAtual } = calcularMetricasOee(turnoSelecionado, velocidadeNominalPpm);

  const turnoLabel = (key) => {
    const t = turnos[key];
    if (!t?.nome) return key === 'turnoA' ? 'Turno A' : key === 'turnoB' ? 'Turno B' : 'Turno C';
    return t.isAtual ? `${t.nome} (Atual)` : t.nome;
  };

  const currentMetrics = {
    availability, performance, quality, oee: oeeAtual,
    label: turnoLabel(selectedTurno)
  };

  // Textos dos tooltips (ícone "i" ao lado de cada campo calculado) — sempre
  // com a fórmula E os números reais que chegaram naquele valor, pra quem
  // está olhando entender de onde veio o percentual sem precisar perguntar.
  const plannedSegAtual = turnoSelecionado.plannedSeg || 0;
  const runTimeMin = runTimeSec / 60;
  const velocidadeMediaRealPpm = runTimeSec > 0 ? (totalCount / runTimeMin) : 0;

  const tooltipDisponibilidade =
    `Disponibilidade = Tempo Rodando ÷ Tempo Planejado × 100\n` +
    `${runTimeSec}s ÷ ${plannedSegAtual.toFixed(0)}s = ${availability.toFixed(1)}%\n\n` +
    `Tempo Planejado já descontou as paradas PROGRAMADAS (limpeza, setup) da duração do turno.`;

  const tooltipQualidade =
    `Qualidade = Peças Boas ÷ Total Produzido × 100\n` +
    `${goodCount} ÷ ${totalCount} = ${quality.toFixed(1)}%\n\n` +
    (totalCount === 0
      ? `Sem nenhuma peça produzida no período, mostra 0% — não 100%: não dá pra dizer que a qualidade foi boa se nada saiu.`
      : `Peças Boas = Total Produzido − Refugo (${totalCount} − ${refugoCount}).`);

  const tooltipPerformance =
    `Performance = Velocidade Média Real ÷ Velocidade Nominal × 100\n` +
    `Vel. Média Real = Total Produzido ÷ Minutos Rodando = ${totalCount} ÷ ${runTimeMin.toFixed(1)}min = ${velocidadeMediaRealPpm.toFixed(1)} pct/min\n` +
    `${velocidadeMediaRealPpm.toFixed(1)} ÷ ${velocidadeNominalPpm} = ${performance.toFixed(1)}%\n\n` +
    `É a MÉDIA desde o início do turno (ou desde o último "Zerar") — pode ser diferente da leitura instantânea do CLP agora mesmo.`;

  const tooltipOeeGauge =
    `OEE = Disponibilidade × Performance × Qualidade ÷ 100²\n` +
    `${availability.toFixed(1)}% × ${performance.toFixed(1)}% × ${quality.toFixed(1)}% = ${oeeAtual.toFixed(1)}%\n\n` +
    `Cálculo oficial (padrão internacional) de eficiência da linha. Meta configurada: ${metaAtual}%.`;

  const tooltipTendencia =
    `Cada ponto do gráfico é o OEE só DAQUELA janela de 15 minutos — não é acumulado desde o início do turno.\n\n` +
    `Por isso pode aparecer diferente do número atual dos cards/gauges acima, que é a média desde o início do turno (ou desde o último "Zerar").`;

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
          const pontos = (data.pontos || []).map((p) => {
            const m = calcularMetricasOee(p, nominal);
            return {
              tempoMs: p.tempoMs,
              time: p.label,
              oee: Number(m.oee.toFixed(1)),
              availability: Number(m.availability.toFixed(1)),
              performance: Number(m.performance.toFixed(1)),
              quality: Number(m.quality.toFixed(1))
            };
          });
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

      {/* Seção Central — só os gauges (anel do OEE + os 3 meio-círculos de
          Disponibilidade/Performance/Qualidade, faixas vermelho/amarelo/
          verde, formato copiado de um print de referência, Fase 5). Os
          cards numéricos que ficavam do lado esquerdo foram removidos por
          pedido do usuário — a informação já está nos gauges, mostrar dos
          dois jeitos era redundante. */}
      <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-center gap-6 flex-wrap">
        <OeeRingGauge value={currentMetrics.oee} tooltip={tooltipOeeGauge} />
        <HalfDonutGauge value={currentMetrics.availability} label="Disponibilidade" tooltip={tooltipDisponibilidade} />
        <HalfDonutGauge value={currentMetrics.performance} label="Performance" tooltip={tooltipPerformance} />
        <HalfDonutGauge value={currentMetrics.quality} label="Qualidade" tooltip={tooltipQualidade} />
      </div>

      {/* Gráfico de Tendência */}
      <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-2 shadow-md">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp size={13} className="text-amber-400" /> Evolução do OEE no Turno ({currentMetrics.label}) - Meta: {metaAtual}%
            <InfoTooltip text={tooltipTendencia} />
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">Atual: <strong className="text-amber-400">{currentMetrics.oee.toFixed(1)}%</strong></span>
        </div>

        {/* Disponibilidade/Performance/Qualidade entram como áreas
            translúcidas INDEPENDENTES (sem stackId) — são 3 percentuais que
            não somam 100%, então empilhar (somar) distorceria a leitura.
            A linha do OEE fica por cima, igual ao print de referência. */}
        <div className="flex gap-2" style={{ width: '100%', height: '110px' }}>
          <div className="flex-1 bg-slate-900/70 p-1.5 rounded-lg border border-slate-700/60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={historyData} margin={{ top: 5, right: 15, left: -20, bottom: -5 }}>
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
                />
                <ReferenceLine y={metaAtual} stroke="#eab308" strokeDasharray="4 4" label={{ value: `Meta ${metaAtual}%`, fill: '#eab308', fontSize: 10, position: 'top' }} />

                <Area type="monotone" dataKey="availability" name="Disponibilidade" stroke="#9d174d" fill="#9d174d" fillOpacity={0.55} />
                <Area type="monotone" dataKey="performance" name="Performance" stroke="#f97316" fill="#f97316" fillOpacity={0.5} />
                <Area type="monotone" dataKey="quality" name="Qualidade" stroke="#fb7185" fill="#fb7185" fillOpacity={0.45} />
                <Line type="monotone" dataKey="oee" name="OEE" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3, fill: '#ef4444' }} activeDot={{ r: 5 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legenda — mesmas cores das séries acima, ordem igual ao print. */}
          <div className="shrink-0 flex flex-col justify-center gap-1.5 pr-1">
            {[
              { cor: '#ef4444', label: 'OEE', dot: true },
              { cor: '#9d174d', label: 'Disponibilidade' },
              { cor: '#f97316', label: 'Performance' },
              { cor: '#fb7185', label: 'Qualidade' }
            ].map((it) => (
              <div key={it.label} className="flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 shrink-0 ${it.dot ? 'rounded-full' : 'rounded-sm'}`} style={{ backgroundColor: it.cor }} />
                <span className="text-[10px] text-slate-300 font-semibold whitespace-nowrap">{it.label}</span>
              </div>
            ))}
          </div>
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
