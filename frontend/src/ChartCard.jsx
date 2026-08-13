import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Download, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine
} from 'recharts';

// Paleta de cores usada como fallback para variáveis sem cor configurada
const FALLBACK_COLORS = ['#38bdf8', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#eab308', '#f472b6', '#2dd4bf'];

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

const exportToPDF = (title, data, seriesMeta) => {
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
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Resumo Operacional por Variavel:", 14, y);
  y += 8;

  seriesMeta.forEach((s) => {
    const values = data.map((d) => d[s.field]).filter((v) => v !== undefined && v !== null);
    if (values.length === 0) return;
    const minVal = Math.min(...values).toFixed(2);
    const maxVal = Math.max(...values).toFixed(2);
    const avgVal = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);

    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`${s.descricao} (${s.field}):`, 20, y);
    y += 6;
    doc.setTextColor(80);
    doc.text(`  Min: ${minVal} ${s.unidade}   Max: ${maxVal} ${s.unidade}   Media: ${avgVal} ${s.unidade}   Faixa: ${s.minLimit} a ${s.maxLimit} ${s.unidade}`, 20, y);
    y += 8;
  });

  y += 2;
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Ultimas Medicoes Registradas:", 14, y);
  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Data e Hora", 14, y);
  seriesMeta.forEach((s, idx) => {
    doc.text(`${s.field} (${s.unidade})`, 80 + idx * 35, y);
  });
  y += 5;

  const sampleData = data.slice(-15);
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

export default function ChartCard({ chart, timeRange, customDates, refreshInterval, onRemove, onAlertStatusChange, isMuted }) {
  const fields = Array.isArray(chart.fields) ? chart.fields : (chart.field ? [chart.field] : []);
  const isSingleField = fields.length === 1;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sensorConfigsMap, setSensorConfigsMap] = useState({});

  useEffect(() => {
    fetch('http://192.168.15.108:5000/api/config/sensores')
      .then((res) => res.json())
      .then((configs) => setSensorConfigsMap(configs || {}))
      .catch((err) => console.error('Erro ao buscar config:', err));
  }, [chart.id]);

  // Metadados de cada variável do gráfico (descrição, unidade, limites, cor, fator de correção)
  const seriesMeta = fields.map((field, idx) => {
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
  });

  const chartTitle = seriesMeta.map((s) => s.descricao).join(' + ') || chart.title;

  const alarmDispatchedRef = useRef({});

  const fetchData = async () => {
    try {
      const results = await Promise.all(
        seriesMeta.map(async (s) => {
          let url = `http://192.168.15.108:5000/api/influx/metric?field=${s.field}`;
          if (customDates?.startDate && customDates?.endDate) {
            url += `&startDate=${encodeURIComponent(customDates.startDate)}&endDate=${encodeURIComponent(customDates.endDate)}`;
          } else {
            url += `&range=${timeRange}`;
          }
          const response = await fetch(url);
          const result = await response.json();
          return { field: s.field, points: Array.isArray(result) ? result : [] };
        })
      );

      // Junta os pontos de todas as variáveis por timestamp num único array,
      // aplicando o fator de correção de cada uma.
      const merged = new Map();
      results.forEach(({ field, points }) => {
        const meta = seriesMeta.find((s) => s.field === field);
        points.forEach((pt) => {
          const key = pt.timestamp;
          const value = Number((pt.value * meta.fatorCorrecao).toFixed(2));
          if (!merged.has(key)) {
            merged.set(key, { timestamp: pt.timestamp, time: pt.time });
          }
          merged.get(key)[field] = value;
        });
      });

      const mergedArray = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
      setData(mergedArray);

      if (mergedArray.length > 0) {
        const lastPoint = mergedArray[mergedArray.length - 1];
        let anyOutOfRange = false;

        seriesMeta.forEach((s) => {
          const val = lastPoint[s.field];
          if (val === undefined) return;
          const outOfRange = val > s.maxLimit || val < s.minLimit;
          if (outOfRange) anyOutOfRange = true;

          if (outOfRange) {
            if (!alarmDispatchedRef.current[s.field]) {
              playAlarmSound(isMuted);
              alarmDispatchedRef.current[s.field] = true;
            }
          } else {
            alarmDispatchedRef.current[s.field] = false;
          }
        });

        if (onAlertStatusChange) onAlertStatusChange(chart.id, anyOutOfRange);
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
  }, [chart.id, JSON.stringify(fields), timeRange, customDates, refreshInterval, isMuted, JSON.stringify(sensorConfigsMap)]);

  const lastRow = data.length > 0 ? data[data.length - 1] : null;
  const isOutOfRange = lastRow
    ? seriesMeta.some((s) => {
        const v = lastRow[s.field];
        return v !== undefined && (v > s.maxLimit || v < s.minLimit);
      })
    : false;

  const getDomainY = () => {
    const allValues = data.flatMap((row) => seriesMeta.map((s) => row[s.field]).filter((v) => v !== undefined));
    const limitValues = isSingleField ? [seriesMeta[0].minLimit, seriesMeta[0].maxLimit] : [];
    const combined = [...allValues, ...limitValues];
    if (combined.length === 0) return ['auto', 'auto'];
    const minVal = Math.min(...combined);
    const maxVal = Math.max(...combined);
    const padding = (maxVal - minVal) * 0.2 || 10;
    return [Math.floor(minVal - padding), Math.ceil(maxVal + padding)];
  };

  const formatXTick = (tickItem) => {
    if (!tickItem) return '';
    const dateObj = new Date(tickItem);
    return dateObj.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
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
                return (
                  <span key={s.field}>
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
          <button onClick={() => exportToCSV(chartTitle, data, seriesMeta)} className="text-slate-400 hover:text-emerald-400 p-1" title="Exportar CSV"><Download size={14} /></button>
          <button onClick={() => exportToPDF(chartTitle, data, seriesMeta)} className="text-slate-400 hover:text-amber-400 p-1" title="Exportar PDF"><FileText size={14} /></button>
          <button onClick={() => onRemove(chart.id)} className="text-slate-400 hover:text-red-400 p-1" title="Remover Gráfico"><Trash2 size={14} /></button>
        </div>
      </div>

      {isSingleField && (
        <div className="flex gap-3 mb-2 bg-slate-900/60 px-2 py-1 rounded border border-slate-700/50 text-[11px] font-mono">
          <span className="text-blue-400">Mín: {seriesMeta[0].minLimit} {seriesMeta[0].unidade}</span>
          <span className="text-red-400">Máx: {seriesMeta[0].maxLimit} {seriesMeta[0].unidade}</span>
        </div>
      )}

      <div className="flex-1 w-full bg-slate-900/50 rounded p-1 border border-slate-700/50 min-h-[140px]">
        {!loading && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />

              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatXTick}
                stroke="#94a3b8"
                fontSize={9}
              />

              <YAxis stroke="#94a3b8" fontSize={9} domain={getDomainY()} unit={isSingleField ? seriesMeta[0].unidade : ''} />

              <Tooltip
                labelFormatter={(value) => new Date(value).toLocaleString('pt-BR')}
                formatter={(val, name) => {
                  const meta = seriesMeta.find((s) => s.field === name);
                  return [`${val} ${meta?.unidade || ''}`, meta?.descricao || name];
                }}
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
              />

              {!isSingleField && <Legend wrapperStyle={{ fontSize: '10px' }} formatter={(value) => seriesMeta.find((s) => s.field === value)?.descricao || value} />}

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
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
