import React, { useState, useEffect, useCallback } from 'react';
import api, { isOk } from './api';
import jsPDF from 'jspdf';
import { Home, AlertTriangle, Search, Download, FileText, RefreshCw, AlertCircle, Loader2, X, CheckCircle2, ShieldCheck } from 'lucide-react';

// Deriva um rótulo/estilo de status a partir de status (ATIVO/NORMALIZADO) +
// acknowledged — as três situações que o usuário acompanha: ativo sem
// reconhecer, ativo já reconhecido, ou normalizado (voltou ao normal).
const getStatusInfo = (row) => {
  if (row.status === 'ATIVO' && !row.acknowledged) {
    return { label: 'Ativo — não reconhecido', className: 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' };
  }
  if (row.status === 'ATIVO' && row.acknowledged) {
    return { label: 'Ativo — reconhecido', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' };
  }
  return { label: 'Normalizado', className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' };
};

const formatClearedInfo = (row) => {
  if (!row.cleared_at_formatted) return '—';
  return row.cleared_by ? `${row.cleared_at_formatted} (manual: ${row.cleared_by})` : row.cleared_at_formatted;
};

const formatRowForExport = (row) => ({
  disparado: row.formatted_date,
  variavel: row.field_name,
  tipo: row.limit_type === 'MAX' ? 'Excesso (máx)' : 'Queda (mín)',
  valor: row.value_read,
  limite: row.limit_value,
  status: getStatusInfo(row).label,
  reconhecidoPor: row.acknowledged ? `${row.acknowledged_by || '—'} em ${row.acknowledged_at_formatted || '—'}` : '—',
  normalizadoEm: formatClearedInfo(row)
});

const exportAlarmsToCSV = (rows) => {
  if (!rows || rows.length === 0) return;
  const header = ['Disparado em', 'Variável', 'Tipo', 'Valor Lido', 'Limite', 'Status', 'Reconhecido por', 'Normalizado em'].join(';');
  let csvContent = `data:text/csv;charset=utf-8,${header}\n`;
  rows.forEach((row) => {
    const r = formatRowForExport(row);
    csvContent += `${[r.disparado, r.variavel, r.tipo, r.valor, r.limite, r.status, r.reconhecidoPor.replace(/;/g, ','), r.normalizadoEm].join(';')}\n`;
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `alarmes_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const exportAlarmsToPDF = (rows, activeFilters) => {
  if (!rows || rows.length === 0) return;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setTextColor(217, 119, 6);
  doc.text('Relatorio de Alarmes - Forno Industrial', 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Data do Relatorio: ${new Date().toLocaleString('pt-BR')}`, 14, 28);

  let y = 34;
  const filterParts = [];
  if (activeFilters.fieldName) filterParts.push(`Variavel: ${activeFilters.fieldName}`);
  if (activeFilters.status) filterParts.push(`Status: ${activeFilters.status}`);
  if (activeFilters.startDate) filterParts.push(`De: ${activeFilters.startDate.replace('T', ' ')}`);
  if (activeFilters.endDate) filterParts.push(`Ate: ${activeFilters.endDate.replace('T', ' ')}`);
  if (activeFilters.search) filterParts.push(`Busca: "${activeFilters.search}"`);
  doc.text(`Filtros aplicados: ${filterParts.length > 0 ? filterParts.join('  |  ') : 'nenhum (todos os registros)'}`, 14, y);
  y += 6;
  doc.text(`Total de registros: ${rows.length}`, 14, y);
  y += 4;
  doc.line(14, y, 196, y);
  y += 8;

  const COLS = [
    { key: 'disparado', label: 'Disparado', x: 14, width: 26 },
    { key: 'variavel', label: 'Variavel', x: 42, width: 18 },
    { key: 'tipo', label: 'Tipo', x: 62, width: 20 },
    { key: 'valor', label: 'Valor', x: 84, width: 14 },
    { key: 'limite', label: 'Limite', x: 100, width: 14 },
    { key: 'status', label: 'Status', x: 116, width: 32 },
    { key: 'reconhecidoPor', label: 'Reconhecido por', x: 150, width: 46 }
  ];

  const drawHeader = () => {
    doc.setFontSize(7.5);
    doc.setTextColor(100);
    COLS.forEach((col) => doc.text(col.label, col.x, y));
    y += 2;
    doc.line(14, y, 196, y);
    y += 5;
  };

  drawHeader();

  rows.forEach((row) => {
    if (y > 280) {
      doc.addPage();
      y = 20;
      drawHeader();
    }
    const r = formatRowForExport(row);
    doc.setFontSize(7);
    doc.setTextColor(0);
    COLS.forEach((col) => {
      const text = doc.splitTextToSize(String(r[col.key]), col.width);
      doc.text(text[0] || '', col.x, y);
    });
    y += 6;
  });

  doc.save(`alarmes_${Date.now()}.pdf`);
};

// Tela de alarmes — histórico completo com ciclo de vida (ativo/reconhecido/
// normalizado), filtros, exportação e ação de reconhecimento. Substitui o
// antigo modal (AlarmModal.jsx, agora sem uso).
export default function AlarmsView({ onBack, currentUserRole }) {
  // Normalizar manualmente é uma correção do estado do sistema (não uma
  // ação de rotina), então fica restrita a supervisor/administrador —
  // mesmo padrão das telas de configuração (Turnos, Variáveis).
  const canManualClear = currentUserRole === 'supervisor' || currentUserRole === 'administrador';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [acknowledgingId, setAcknowledgingId] = useState(null);
  const [clearingId, setClearingId] = useState(null);

  const [fieldNameFilter, setFieldNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const fetchAlarms = useCallback(async (filters) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = {};
      if (filters.fieldName) params.fieldName = filters.fieldName;
      if (filters.status) params.status = filters.status;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.search) params.search = filters.search;

      const res = await api.get('/api/alarms', { params });
      if (isOk(res)) {
        setRows(Array.isArray(res.data) ? res.data : []);
      } else {
        setLoadError(res.data?.error || 'Não foi possível carregar o histórico de alarmes.');
      }
    } catch (err) {
      setLoadError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlarms({ fieldName: '', status: '', startDate: '', endDate: '', search: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentFilters = () => ({
    fieldName: fieldNameFilter,
    status: statusFilter,
    startDate: startDateFilter,
    endDate: endDateFilter,
    search: searchFilter
  });

  const handleApplyFilters = (e) => {
    e.preventDefault();
    fetchAlarms(currentFilters());
  };

  const handleClearFilters = () => {
    setFieldNameFilter('');
    setStatusFilter('');
    setStartDateFilter('');
    setEndDateFilter('');
    setSearchFilter('');
    fetchAlarms({ fieldName: '', status: '', startDate: '', endDate: '', search: '' });
  };

  const handleRefresh = () => fetchAlarms(currentFilters());

  const handleAcknowledge = async (id) => {
    setAcknowledgingId(id);
    try {
      const res = await api.put(`/api/alarms/${id}/acknowledge`);
      if (isOk(res)) {
        fetchAlarms(currentFilters());
      } else {
        setLoadError(res.data?.error || 'Não foi possível reconhecer o alarme.');
      }
    } catch (err) {
      setLoadError('Erro de conexão com o servidor.');
    } finally {
      setAcknowledgingId(null);
    }
  };

  // Corrige manualmente um alarme que ficou marcado ATIVO mesmo com o valor
  // real já normal (ex.: gráfico da variável não está mais na tela, então
  // nada reconcilia automaticamente).
  const handleManualClear = async (id) => {
    setClearingId(id);
    try {
      const res = await api.put(`/api/alarms/${id}/clear`);
      if (isOk(res)) {
        fetchAlarms(currentFilters());
      } else {
        setLoadError(res.data?.error || 'Não foi possível normalizar o alarme.');
      }
    } catch (err) {
      setLoadError('Erro de conexão com o servidor.');
    } finally {
      setClearingId(null);
    }
  };

  const hasActiveFilters = fieldNameFilter || statusFilter || startDateFilter || endDateFilter || searchFilter;

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col overflow-hidden">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <AlertTriangle size={22} /> Central de Alarmes
            </h1>
            <p className="text-slate-400 text-xs">
              Histórico e estado dos alarmes ({rows.length >= 200 ? '200+' : rows.length} registros exibidos)
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => exportAlarmsToCSV(rows)}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            <Download size={14} className="text-amber-400" /> Exportar CSV
          </button>
          <button
            onClick={() => exportAlarmsToPDF(rows, currentFilters())}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            <FileText size={14} className="text-amber-400" /> Exportar PDF
          </button>
        </div>
      </div>

      <form
        onSubmit={handleApplyFilters}
        className="flex flex-wrap items-end gap-3 bg-slate-950/40 p-3 rounded border border-slate-800 my-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-400 font-semibold uppercase">Variável</label>
          <input
            type="text"
            value={fieldNameFilter}
            onChange={(e) => setFieldNameFilter(e.target.value)}
            placeholder="Ex: CTP01"
            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500 w-28"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-400 font-semibold uppercase">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          >
            <option value="">Todos</option>
            <option value="ATIVO_NAO_RECONHECIDO">Ativo — não reconhecido</option>
            <option value="ATIVO_RECONHECIDO">Ativo — reconhecido</option>
            <option value="NORMALIZADO">Normalizado</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-400 font-semibold uppercase">De</label>
          <input
            type="datetime-local"
            value={startDateFilter}
            onChange={(e) => setStartDateFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-400 font-semibold uppercase">Até</label>
          <input
            type="datetime-local"
            value={endDateFilter}
            onChange={(e) => setEndDateFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-[11px] text-slate-400 font-semibold uppercase">Buscar texto</label>
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Procura na variável e no tipo..."
            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </div>

        <button
          type="submit"
          className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-semibold transition"
        >
          <Search size={13} /> Filtrar
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs font-semibold transition"
          >
            <X size={13} /> Limpar
          </button>
        )}

        <button
          type="button"
          onClick={handleRefresh}
          title="Atualizar"
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1.5 rounded text-xs font-semibold transition"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </form>

      {loadError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-3 rounded mb-3">
          <AlertCircle size={14} className="shrink-0" /> {loadError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
            <Loader2 size={18} className="animate-spin" /> Carregando...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">Nenhum alarme encontrado.</div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase">
                <th className="py-2.5 px-3">Disparado em</th>
                <th className="py-2.5 px-3">Variável</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 px-3">Valor</th>
                <th className="py-2.5 px-3">Limite</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Reconhecido</th>
                <th className="py-2.5 px-3">Normalizado em</th>
                <th className="py-2.5 px-3">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200 font-mono">
              {rows.map((row) => {
                const statusInfo = getStatusInfo(row);
                const canAcknowledge = row.status === 'ATIVO' && !row.acknowledged;
                return (
                  <tr key={row.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{row.formatted_date}</td>
                    <td className="py-2.5 px-3 font-bold text-amber-400">{row.field_name}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        row.limit_type === 'MAX' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      }`}>
                        {row.limit_type === 'MAX' ? 'EXCESSO (MÁX)' : 'QUEDA (MÍN)'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-red-400">{row.value_read}</td>
                    <td className="py-2.5 px-3 text-slate-400">{row.limit_value}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                      {row.acknowledged ? `${row.acknowledged_by || '—'} · ${row.acknowledged_at_formatted || '—'}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{formatClearedInfo(row)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canAcknowledge && (
                          <button
                            onClick={() => handleAcknowledge(row.id)}
                            disabled={acknowledgingId === row.id}
                            className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-2 py-1 rounded text-[10px] font-semibold transition whitespace-nowrap"
                          >
                            {acknowledgingId === row.id ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Reconhecer
                          </button>
                        )}
                        {row.status === 'ATIVO' && canManualClear && (
                          <button
                            onClick={() => handleManualClear(row.id)}
                            disabled={clearingId === row.id}
                            title="Marca o alarme como normalizado — use quando o valor real já está dentro da faixa, mas o registro ficou preso como ativo."
                            className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 px-2 py-1 rounded text-[10px] font-semibold transition whitespace-nowrap"
                          >
                            {clearingId === row.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Normalizar manualmente
                          </button>
                        )}
                        {!canAcknowledge && row.acknowledged && row.status !== 'ATIVO' && (
                          <span className="flex items-center gap-1 text-emerald-400 text-[10px]"><CheckCircle2 size={11} /> OK</span>
                        )}
                        {row.status !== 'ATIVO' && !row.acknowledged && (
                          <span className="text-slate-600 text-[10px]">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
