import React, { useState, useEffect, useRef, useMemo } from 'react';
import api, { isOk } from './api';
import { Trash2, Download, FileText, ZoomOut, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea
} from 'recharts';

// Paleta de cores usada como fallback para variáveis sem cor configurada
const FALLBACK_COLORS = ['#38bdf8', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#eab308', '#f472b6', '#2dd4bf'];

// Mínimo/máximo em um loop simples — evita o custo (e o risco de estouro de pilha
// em séries grandes, ex.: período de 7 dias) de Math.min(...array)/Math.max(...array).
const minMax = (values) => {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
};

const exportToCSV = (title, data, seriesMeta) => {
  if (!data || data.length === 0) return;
  const header = ['Data e Hora', ...seriesMeta.map((s) => `${s.descricao} (${s.unidade})`)].join(';');
  let csvContent = `data:text/csv;charset=utf-8,${header}\n`;
  data.forEach((row) => {
    const cols = [row.time, ...seriesMeta.map((s) => (row[s.field] !== undefined ? row[s.field] : ''))];
    csvContent += `${cols.join(';')}\n`;
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `relatorio_${title.replace(/\s+/g, '_')}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const exportToPDF = (title, data, seriesMeta, chartImage) => {
  if (!data || data.length === 0) return;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setTextColor(217, 119, 6);
  doc.text("Relatorio de Historico - Forno Industrial", 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Variavel(is): ${title}`, 14, 28);
  doc.text(`Data do Relatorio: ${new Date().toLocaleString('pt-BR')}`, 14, 34);
  doc.line(14, 38, 196, 38);

  let y = 46;

  // Imagem do gráfico (captura visual colorida, como aparece na tela)
  if (chartImage) {
    const pageWidth = 182; // 196 - 14 margem esquerda
    const imgProps = chartImage.imgProps;
    const imgHeight = (imgProps.height * pageWidth) / imgProps.width;
    doc.addImage(chartImage.dataUrl, 'PNG', 14, y, pageWidth, imgHeight);
    y += imgHeight + 10;
  }

  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Resumo Operacional por Variavel:", 14, y);
  y += 8;

  seriesMeta.forEach((s) => {
    const values = data.map((d) => d[s.field]).filter((v) => v !== undefined && v !== null);
    if (values.length === 0) return;
    const [minVal, maxVal] = minMax(values);
    const avgVal = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);

    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`${s.descricao} (${s.field}):`, 20, y);
    y += 6;
    doc.setTextColor(80);
    doc.text(`  Min: ${minVal.toFixed(2)} ${s.unidade}   Max: ${maxVal.toFixed(2)} ${s.unidade}   Media: ${avgVal} ${s.unidade}   Faixa: ${s.minLimit} a ${s.maxLimit} ${s.unidade}`, 20, y);
    y += 8;
  });

  y += 2;
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Amostra de Medicoes ao Longo do Periodo Selecionado:", 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Periodo: ${data[0].time}  ate  ${data[data.length - 1].time}  (${data.length} registros no total)`, 14, y);
  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Data e Hora", 14, y);
  seriesMeta.forEach((s, idx) => {
    doc.text(`${s.field} (${s.unidade})`, 80 + idx * 35, y);
  });
  y += 5;

  // Amostragem distribuida por todo o periodo selecionado (nao apenas os
  // ultimos registros), garantindo que o primeiro e o ultimo ponto do
  // intervalo apareçam no relatorio.
  const SAMPLE_SIZE = 25;
  let sampleData;
  if (data.length <= SAMPLE_SIZE) {
    sampleData = data;
  } else {
    const step = (data.length - 1) / (SAMPLE_SIZE - 1);
    const indices = new Set();
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      indices.add(Math.round(i * step));
    }
    sampleData = Array.from(indices).sort((a, b) => a - b).map((idx) => data[idx]);
  }

  sampleData.forEach((row) => {
    doc.setTextColor(0);
    doc.text(String(row.time), 14, y);
    seriesMeta.forEach((s, idx) => {
      const v = row[s.field];
      doc.text(v !== undefined && v !== null ? String(v) : '-', 80 + idx * 35, y);
    });
    y += 6;
    if (y > 280) {
      doc.addPage();
      y = 20;
    }
  });

  doc.save(`relatorio_${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
};

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

function ChartCard({ chart, timeRange, customDates, refreshInterval, onRemove, isMuted }) {
  const fields = useMemo(
    () => (Array.isArray(chart.fields) ? chart.fields : (chart.field ? [chart.field] : [])),
    [chart.fields, chart.field]
  );
  const isSingleField = fields.length === 1;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sensorConfigsMap, setSensorConfigsMap] = useState({});
  // Só fica true depois que a configuração real de limites chegou do
  // servidor — evita avaliar alarme com os limites 0/0 (fallback) que
  // existem por uma fração de segundo antes disso, o que faria qualquer
  // valor positivo parecer "acima do máximo".
  const [sensorConfigLoaded, setSensorConfigLoaded] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const chartContainerRef = useRef(null);

  // Controle de "penas" (séries) ligadas/desligadas no gráfico
  const [hiddenFields, setHiddenFields] = useState([]);

  // Controle de zoom por arrastar seleção no eixo X
  const [zoomDomain, setZoomDomain] = useState(null); // [inicio, fim] em timestamp, ou null (intervalo completo)
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);

  useEffect(() => {
    api.get('/api/config/sensores')
      .then((res) => {
        setSensorConfigsMap(res.data || {});
        setSensorConfigLoaded(true);
      })
      .catch((err) => console.error('Erro ao buscar config:', err));
  }, [chart.id]);

  // Sempre que o intervalo de tempo do dashboard muda, o zoom manual perde o sentido — reseta.
  useEffect(() => {
    setZoomDomain(null);
    setRefAreaLeft(null);
    setRefAreaRight(null);
  }, [timeRange, customDates]);

  // Metadados de cada variável do gráfico (descrição, unidade, limites, cor, fator de correção).
  // Memoizado: só recalcula quando os campos do gráfico ou as configs de sensores mudam.
  const seriesMeta = useMemo(
    () => fields.map((field, idx) => {
      const cfg = sensorConfigsMap[field] || {};
      return {
        field,
        descricao: cfg.descricao || field,
        unidade: cfg.unidade || '',
        minLimit: Number(cfg.minLimit) || 0,
        maxLimit: Number(cfg.maxLimit) || 0,
        cor: cfg.cor || FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
        fatorCorrecao: Number(cfg.fatorCorrecao) || 1.0,
      };
    }),
    [fields, sensorConfigsMap]
  );

  const chartTitle = useMemo(
    () => seriesMeta.map((s) => s.descricao).join(' + ') || chart.title,
    [seriesMeta, chart.title]
  );

  const toggleFieldVisibility = (field) => {
    setHiddenFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const alarmDispatchedRef = useRef({});

  const fetchData = async () => {
    try {
      const fieldsParam = seriesMeta.map((s) => s.field).join(',');
      if (!fieldsParam) { setLoading(false); return; }

      const params = { fields: fieldsParam };
      if (customDates?.startDate && customDates?.endDate) {
        params.startDate = customDates.startDate;
        params.endDate = customDates.endDate;
      } else {
        params.range = timeRange;
      }

      const response = await api.get('/api/influx/metrics', { params });
      const result = response.data;
      const points = Array.isArray(result) ? result : [];

      const processed = points.map((pt) => {
        const row = { timestamp: pt.timestamp, time: pt.time };
        seriesMeta.forEach((s) => {
          if (pt[s.field] !== undefined && pt[s.field] !== null) {
            row[s.field] = Number((pt[s.field] * s.fatorCorrecao).toFixed(2));
          }
        });
        return row;
      });

      setData(processed);

      // Só avalia alarme depois que os limites reais do sensor chegaram do
      // servidor — antes disso, seriesMeta ainda está com o fallback 0/0 e
      // qualquer leitura pareceria "fora da faixa".
      if (processed.length > 0 && sensorConfigLoaded) {
        const lastPoint = processed[processed.length - 1];

        seriesMeta.forEach((s) => {
          const val = lastPoint[s.field];
          if (val === undefined) return;
          const breachedMax = val > s.maxLimit;
          const breachedMin = val < s.minLimit;
          const outOfRange = breachedMax || breachedMin;

          if (outOfRange) {
            // Dispara só na borda de transição (quando o valor acabou de
            // cruzar o limite) — não a cada leitura enquanto ele continua
            // fora da faixa — para não encher o histórico de alarmes com
            // centenas de registros repetidos do mesmo desvio.
            if (!alarmDispatchedRef.current[s.field]) {
              playAlarmSound(isMuted);
              alarmDispatchedRef.current[s.field] = true;
              const limitType = breachedMax ? 'MAX' : 'MIN';
              const limitValue = breachedMax ? s.maxLimit : s.minLimit;
              api.post('/api/alarms/trigger', { fieldName: s.field, valueRead: val, limitType, limitValue })
                .catch((err) => console.error('Erro ao registrar disparo de alarme:', err));
            }
          } else {
            // Reconcilia com o servidor na primeira leitura normal desta
            // instância do gráfico (a ref ainda não é "false", ou seja,
            // nunca confirmamos que está tudo ok por aqui) — cobre o caso
            // de um alarme ter ficado ATIVO de uma sessão anterior (página
            // recarregada, gráfico removido e recolocado, etc.) enquanto
            // este componente específico nunca viu a transição de saída.
            // Depois da primeira reconciliação, só chama de novo numa
            // borda de transição real — não a cada leitura.
            if (alarmDispatchedRef.current[s.field] !== false) {
              api.post('/api/alarms/resolve', { fieldName: s.field })
                .catch((err) => console.error('Erro ao normalizar alarme:', err));
            }
            alarmDispatchedRef.current[s.field] = false;
          }
        });
      }
    } catch (err) { console.error('Erro:', err); } finally { setLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    if (refreshInterval === 0 || (customDates?.startDate && customDates?.endDate)) return;
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.id, seriesMeta, timeRange, customDates, refreshInterval, isMuted, sensorConfigLoaded]);

  const lastRow = data.length > 0 ? data[data.length - 1] : null;
  const isOutOfRange = lastRow
    ? seriesMeta.some((s) => {
        const v = lastRow[s.field];
        return v !== undefined && (v > s.maxLimit || v < s.minLimit);
      })
    : false;

  const visibleSeriesMeta = useMemo(
    () => seriesMeta.filter((s) => !hiddenFields.includes(s.field)),
    [seriesMeta, hiddenFields]
  );

  // Domínio do eixo Y memoizado — só recalcula quando os dados, as séries visíveis
  // ou os limites configurados realmente mudam (não a cada re-render do componente).
  const domainY = useMemo(() => {
    const relevantSeries = visibleSeriesMeta.length > 0 ? visibleSeriesMeta : seriesMeta;
    const allValues = [];
    for (const row of data) {
      for (const s of relevantSeries) {
        const v = row[s.field];
        if (v !== undefined) allValues.push(v);
      }
    }
    if (isSingleField) {
      allValues.push(seriesMeta[0].minLimit, seriesMeta[0].maxLimit);
    }
    if (allValues.length === 0) return ['auto', 'auto'];
    const [minVal, maxVal] = minMax(allValues);
    const padding = (maxVal - minVal) * 0.2 || 10;
    return [Math.floor(minVal - padding), Math.ceil(maxVal + padding)];
  }, [data, visibleSeriesMeta, seriesMeta, isSingleField]);

  const formatXTick = (tickItem) => {
    if (!tickItem) return '';
    const dateObj = new Date(tickItem);
    return dateObj.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // --- Zoom por arrastar seleção no eixo X ---
  const handleMouseDown = (e) => {
    if (e && e.activeLabel !== undefined && e.activeLabel !== null) {
      setRefAreaLeft(e.activeLabel);
      setRefAreaRight(e.activeLabel);
    }
  };

  const handleMouseMove = (e) => {
    if (refAreaLeft !== null && e && e.activeLabel !== undefined && e.activeLabel !== null) {
      setRefAreaRight(e.activeLabel);
    }
  };

  const handleMouseUp = () => {
    if (refAreaLeft === null || refAreaRight === null || refAreaLeft === refAreaRight) {
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }
    const [left, right] = refAreaLeft < refAreaRight ? [refAreaLeft, refAreaRight] : [refAreaRight, refAreaLeft];
    setZoomDomain([left, right]);
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const resetZoom = () => {
    setZoomDomain(null);
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  // Captura o gráfico (como está na tela, com as cores e a área de zoom atual)
  // em uma imagem PNG e monta o PDF com ela no topo do relatório.
  const handleExportPDF = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      let chartImage = null;
      if (chartContainerRef.current) {
        const canvas = await html2canvas(chartContainerRef.current, {
          backgroundColor: '#0f172a',
          scale: 2,
          logging: false
        });
        chartImage = {
          dataUrl: canvas.toDataURL('image/png'),
          imgProps: { width: canvas.width, height: canvas.height }
        };
      }
      exportToPDF(chartTitle, data, seriesMeta, chartImage);
    } catch (err) {
      console.error('Erro ao capturar imagem do gráfico para o PDF:', err);
      exportToPDF(chartTitle, data, seriesMeta, null);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className={`bg-slate-800 border rounded-lg p-3 shadow-lg flex flex-col justify-between h-full w-full transition-all ${isOutOfRange ? 'border-red-500/80 bg-red-950/30 ring-2 ring-red-500/50' : 'border-slate-700'}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <h2 className="font-semibold text-sm text-slate-200">{chartTitle}</h2>
          {lastRow !== null && (
            <p className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
              {seriesMeta.map((s) => {
                const v = lastRow[s.field];
                const out = v !== undefined && (v > s.maxLimit || v < s.minLimit);
                const isHidden = hiddenFields.includes(s.field);
                return (
                  <span key={s.field} className={isHidden ? 'opacity-40' : ''}>
                    {isSingleField ? 'Valor atual: ' : `${s.descricao}: `}
                    <span className={`font-mono font-bold text-xs ${out ? 'text-red-400' : 'text-amber-400'}`}>
                      {v !== undefined ? v : '--'} {s.unidade}
                    </span>
                  </span>
                );
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {zoomDomain && (
            <button onClick={resetZoom} className="text-slate-400 hover:text-amber-400 p-1" title="Resetar Zoom">
              <ZoomOut size={14} />
            </button>
          )}
          <button onClick={() => exportToCSV(chartTitle, data, seriesMeta)} className="text-slate-400 hover:text-emerald-400 p-1" title="Exportar CSV"><Download size={14} /></button>
          <button onClick={handleExportPDF} disabled={exportingPdf} className="text-slate-400 hover:text-amber-400 p-1 disabled:opacity-50" title="Exportar PDF">
            {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          </button>
          <button onClick={() => onRemove(chart.id)} className="text-slate-400 hover:text-red-400 p-1" title="Remover Gráfico"><Trash2 size={14} /></button>
        </div>
      </div>

      {isSingleField && (
        <div className="flex gap-3 mb-2 bg-slate-900/60 px-2 py-1 rounded border border-slate-700/50 text-[11px] font-mono">
          <span className="text-blue-400">Mín: {seriesMeta[0].minLimit} {seriesMeta[0].unidade}</span>
          <span className="text-red-400">Máx: {seriesMeta[0].maxLimit} {seriesMeta[0].unidade}</span>
        </div>
      )}

      {/* Chips de habilitar/desabilitar "penas" (séries) */}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {seriesMeta.map((s) => {
          const isHidden = hiddenFields.includes(s.field);
          return (
            <button
              key={s.field}
              type="button"
              onClick={() => toggleFieldVisibility(s.field)}
              title={isHidden ? 'Clique para exibir esta variável' : 'Clique para ocultar esta variável'}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition ${
                isHidden
                  ? 'border-slate-700 text-slate-500 bg-slate-900/40 line-through'
                  : 'border-slate-600 text-slate-200 bg-slate-900/60'
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: isHidden ? '#475569' : s.cor }} />
              {s.descricao}
            </button>
          );
        })}
      </div>

      <div ref={chartContainerRef} className="flex-1 w-full bg-slate-900/50 rounded p-1 border border-slate-700/50 min-h-[140px] select-none">
        {!loading && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              style={{ cursor: 'crosshair' }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />

              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={zoomDomain || ['dataMin', 'dataMax']}
                allowDataOverflow
                tickFormatter={formatXTick}
                stroke="#94a3b8"
                fontSize={9}
              />

              <YAxis stroke="#94a3b8" fontSize={9} domain={domainY} unit={isSingleField ? seriesMeta[0].unidade : ''} />

              <Tooltip
                labelFormatter={(value) => new Date(value).toLocaleString('pt-BR')}
                formatter={(val, name) => {
                  const meta = seriesMeta.find((s) => s.field === name);
                  return [`${val} ${meta?.unidade || ''}`, meta?.descricao || name];
                }}
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
              />

              {isSingleField && (
                <>
                  <ReferenceLine y={seriesMeta[0].maxLimit} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={2} label={{ value: 'MÁX', fill: '#ef4444', fontSize: 8, position: 'insideTopRight' }} />
                  <ReferenceLine y={seriesMeta[0].minLimit} stroke="#3b82f6" strokeDasharray="5 5" strokeWidth={2} label={{ value: 'MÍN', fill: '#3b82f6', fontSize: 8, position: 'insideBottomRight' }} />
                </>
              )}

              {seriesMeta.map((s) => (
                <Line
                  key={s.field}
                  type="monotone"
                  dataKey={s.field}
                  name={s.field}
                  stroke={isSingleField && isOutOfRange ? '#ef4444' : s.cor}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  hide={hiddenFields.includes(s.field)}
                  isAnimationActive={false}
                />
              ))}

              {refAreaLeft !== null && refAreaRight !== null && (
                <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.4} fill="#f59e0b" fillOpacity={0.15} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default React.memo(ChartCard);
