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
  CartesianGrid,
  ReferenceLine
} from 'recharts';

const exportToCSV = (fieldName, data, unidade) => {
  if (!data || data.length === 0) return;
  let csvContent = `data:text/csv;charset=utf-8,Data e Hora;Valor (${unidade})\n`;
  data.forEach((row) => { csvContent += `${row.time};${row.value}\n`; });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `relatorio_${fieldName}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const exportToPDF = (fieldName, data, minLimit, maxLimit, unidade, descricao) => {
  if (!data || data.length === 0) return;
  const doc = new jsPDF();
  const values = data.map((d) => d.value);
  const minVal = Math.min(...values).toFixed(2);
  const maxVal = Math.max(...values).toFixed(2);
  const avgVal = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);

  doc.setFontSize(18);
  doc.setTextColor(217, 119, 6);
  doc.text("Relatorio de Historico - Forno Industrial", 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Variavel: ${descricao || fieldName} (${fieldName})`, 14, 28);
  doc.text(`Data do Relatorio: ${new Date().toLocaleString('pt-BR')}`, 14, 34);
  doc.line(14, 38, 196, 38);
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Resumo Operacional:", 14, 46);
  doc.setFontSize(10);
  doc.text(`* Total de Registros: ${data.length} leituras`, 20, 54);
  doc.text(`* Valor Minimo Lido: ${minVal} ${unidade}`, 20, 60);
  doc.text(`* Valor Maximo Lido: ${maxVal} ${unidade}`, 20, 66);
  doc.text(`* Media do Periodo: ${avgVal} ${unidade}`, 20, 72);
  doc.text(`* Faixa Configurada: ${minLimit} ate ${maxLimit} ${unidade}`, 20, 78);
  doc.line(14, 84, 196, 84);
  doc.text("Ultimas Medicoes Registradas:", 14, 92);
  let y = 100;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Data e Hora", 20, y);
  doc.text(`Valor (${unidade})`, 100, y);
  y += 6;
  const sampleData = data.slice(-15);
  sampleData.forEach((row) => {
    doc.setTextColor(0);
    doc.text(String(row.time), 20, y);
    doc.text(`${String(row.value)} ${unidade}`, 100, y);
    y += 6;
  });
  doc.save(`relatorio_${fieldName}_${Date.now()}.pdf`);
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
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sensorConfig, setSensorConfig] = useState({
    descricao: chart.title, unidade: '', minLimit: 0, maxLimit: 0, cor: '#f59e0b', fatorCorrecao: 1.0
  });

  useEffect(() => {
    fetch('http://192.168.15.108:5000/api/config/sensores')
      .then((res) => res.json())
      .then((configs) => {
        if (configs && configs[chart.field]) {
          const cfg = configs[chart.field];
          setSensorConfig({
            descricao: cfg.descricao || chart.title,
            unidade: cfg.unidade || '',
            minLimit: Number(cfg.minLimit) || 0,
            maxLimit: Number(cfg.maxLimit) || 0,
            cor: cfg.cor || '#f59e0b',
            fatorCorrecao: Number(cfg.fatorCorrecao) || 1.0
          });
        }
      })
      .catch((err) => console.error('Erro ao buscar config:', err));
  }, [chart.field]);

  const alarmDispatched = useRef(false);

  const fetchData = async () => {
    try {
      let url = `http://192.168.15.108:5000/api/influx/metric?field=${chart.field}`;
      if (customDates?.startDate && customDates?.endDate) {
        url += `&startDate=${encodeURIComponent(customDates.startDate)}&endDate=${encodeURIComponent(customDates.endDate)}`;
      } else {
        url += `&range=${timeRange}`;
      }
      const response = await fetch(url);
      const result = await response.json();
      if (Array.isArray(result) && result.length > 0) {
        const processedData = result.map((item) => ({ ...item, value: Number((item.value * sensorConfig.fatorCorrecao).toFixed(2)) }));
        setData(processedData);
        const lastVal = processedData[processedData.length - 1].value;
        const outOfRange = lastVal > sensorConfig.maxLimit || lastVal < sensorConfig.minLimit;
        if (onAlertStatusChange) onAlertStatusChange(chart.id, outOfRange);
        if (lastVal > sensorConfig.maxLimit || lastVal < sensorConfig.minLimit) {
          if (!alarmDispatched.current) { playAlarmSound(isMuted); alarmDispatched.current = true; }
        } else { alarmDispatched.current = false; }
      }
    } catch (err) { console.error('Erro:', err); } finally { setLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    if (refreshInterval === 0 || (customDates?.startDate && customDates?.endDate)) return;
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [chart.field, timeRange, customDates, refreshInterval, isMuted, sensorConfig.fatorCorrecao]);

  const lastPoint = data.length > 0 ? data[data.length - 1].value : null;
  const isOutOfRange = lastPoint !== null && (lastPoint > sensorConfig.maxLimit || lastPoint < sensorConfig.minLimit);

  const getDomainY = () => {
    const minVal = data.length > 0 ? Math.min(...data.map(d => d.value), sensorConfig.minLimit) : sensorConfig.minLimit;
    const maxVal = data.length > 0 ? Math.max(...data.map(d => d.value), sensorConfig.maxLimit) : sensorConfig.maxLimit;
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
          <h2 className="font-semibold text-sm text-slate-200">{sensorConfig.descricao}</h2>
          {lastPoint !== null && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Valor atual: <span className={`font-mono font-bold text-xs ${isOutOfRange ? 'text-red-400' : 'text-amber-400'}`}>{lastPoint} {sensorConfig.unidade}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => exportToCSV(chart.field, data, sensorConfig.unidade)} className="text-slate-400 hover:text-emerald-400 p-1" title="Exportar CSV"><Download size={14} /></button>
          <button onClick={() => exportToPDF(chart.field, data, sensorConfig.minLimit, sensorConfig.maxLimit, sensorConfig.unidade, sensorConfig.descricao)} className="text-slate-400 hover:text-amber-400 p-1" title="Exportar PDF"><FileText size={14} /></button>
          <button onClick={() => onRemove(chart.id)} className="text-slate-400 hover:text-red-400 p-1" title="Remover Gráfico"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="flex gap-3 mb-2 bg-slate-900/60 px-2 py-1 rounded border border-slate-700/50 text-[11px] font-mono">
        <span className="text-blue-400">Mín: {sensorConfig.minLimit} {sensorConfig.unidade}</span>
        <span className="text-red-400">Máx: {sensorConfig.maxLimit} {sensorConfig.unidade}</span>
      </div>

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

              <YAxis stroke="#94a3b8" fontSize={9} domain={getDomainY()} unit={sensorConfig.unidade} />
              
              <Tooltip
                labelFormatter={(value) => new Date(value).toLocaleString('pt-BR')}
                formatter={(val) => [`${val} ${sensorConfig.unidade}`, sensorConfig.descricao]}
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
              />
              
              <ReferenceLine y={sensorConfig.maxLimit} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={2} label={{ value: 'MÁX', fill: '#ef4444', fontSize: 8, position: 'insideTopRight' }} />
              <ReferenceLine y={sensorConfig.minLimit} stroke="#3b82f6" strokeDasharray="5 5" strokeWidth={2} label={{ value: 'MÍN', fill: '#3b82f6', fontSize: 8, position: 'insideBottomRight' }} />
              
              <Line type="monotone" dataKey="value" stroke={isOutOfRange ? '#ef4444' : sensorConfig.cor} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}