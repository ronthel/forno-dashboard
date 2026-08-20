import React, { useState, useEffect, useCallback } from 'react';
import api, { isOk } from './api';
import jsPDF from 'jspdf';
import { Home, ScrollText, Search, Download, FileText, RefreshCw, AlertCircle, Loader2, X } from 'lucide-react';

// Formata o campo "details" (objeto JSON ou null) numa string curta e legível,
// ex.: "novoUsuario: joao, perfil: operador".
const formatDetails = (details) => {
  if (!details || typeof details !== 'object') return '—';
  const entries = Object.entries(details);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
};

const exportAuditToCSV = (rows) => {
  if (!rows || rows.length === 0) return;
  const header = ['Data e Hora', 'Usuário', 'Perfil', 'Ação', 'Detalhes'].join(';');
  let csvContent = `data:text/csv;charset=utf-8,${header}\n`;
  rows.forEach((row) => {
    const cols = [
      row.formatted_date,
      row.username,
      row.role || '',
      row.action,
      formatDetails(row.details).replace(/;/g, ',')
    ];
    csvContent += `${cols.join(';')}\n`;
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `auditoria_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Gera um PDF com a lista de registros de auditoria atualmente exibida na
// tela (já filtrada), no mesmo estilo dos relatórios exportados pelos
// gráficos (ver ChartCard.jsx).
const exportAuditToPDF = (rows, activeFilters) => {
  if (!rows || rows.length === 0) return;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setTextColor(217, 119, 6);
  doc.text('Relatorio de Auditoria - Forno Industrial', 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Data do Relatorio: ${new Date().toLocaleString('pt-BR')}`, 14, 28);

  let y = 34;
  const filterParts = [];
  if (activeFilters.username) filterParts.push(`Usuario: ${activeFilters.username}`);
  if (activeFilters.startDate) filterParts.push(`De: ${activeFilters.startDate.replace('T', ' ')}`);
  if (activeFilters.endDate) filterParts.push(`Ate: ${activeFilters.endDate.replace('T', ' ')}`);
  if (activeFilters.search) filterParts.push(`Busca: "${activeFilters.search}"`);
  if (filterParts.length > 0) {
    doc.text(`Filtros aplicados: ${filterParts.join('  |  ')}`, 14, y);
    y += 6;
  } else {
    doc.text('Filtros aplicados: nenhum (todos os registros)', 14, y);
    y += 6;
  }
  doc.text(`Total de registros: ${rows.length}`, 14, y);
  y += 4;
  doc.line(14, y, 196, y);
  y += 8;

  const COLS = [
    { key: 'formatted_date', label: 'Data e Hora', x: 14, width: 32 },
    { key: 'username', label: 'Usuario', x: 48, width: 24 },
    { key: 'role', label: 'Perfil', x: 74, width: 22 },
    { key: 'action', label: 'Acao', x: 98, width: 40 },
    { key: 'details', label: 'Detalhes', x: 140, width: 56 }
  ];

  const drawHeader = () => {
    doc.setFontSize(8);
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
    doc.setFontSize(7.5);
    doc.setTextColor(0);
    const values = {
      formatted_date: row.formatted_date || '',
      username: row.username || '',
      role: row.role || '—',
      action: row.action || '',
      details: formatDetails(row.details)
    };
    COLS.forEach((col) => {
      const text = doc.splitTextToSize(String(values[col.key]), col.width);
      doc.text(text[0] || '', col.x, y);
    });
    y += 6;
  });

  doc.save(`auditoria_${Date.now()}.pdf`);
};

// Tela de auditoria — restrita a administradores. Lista as alterações feitas
// no sistema (quem, quando, o quê), com filtro por usuário, período e texto
// livre, e exportação em CSV dos registros filtrados atualmente na tela.
export default function AuditLogView({ onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [usernameFilter, setUsernameFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  // Recebe os filtros como argumento explícito (em vez de ler do estado por
  // closure) — evita o bug de "filtro não funciona" causado por uma função
  // memoizada presa nos valores iniciais (vazios) dos filtros.
  const fetchAuditLog = useCallback(async (filters) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = {};
      if (filters.username) params.username = filters.username;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.search) params.search = filters.search;

      const res = await api.get('/api/audit-log', { params });
      if (isOk(res)) {
        setRows(Array.isArray(res.data) ? res.data : []);
      } else {
        setLoadError(res.data?.error || 'Não foi possível carregar o histórico de auditoria.');
      }
    } catch (err) {
      setLoadError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Só busca uma vez, ao montar a tela (com filtros vazios) — as buscas
  // seguintes são disparadas pelos botões Filtrar/Limpar/Atualizar.
  useEffect(() => {
    fetchAuditLog({ username: '', startDate: '', endDate: '', search: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentFilters = () => ({
    username: usernameFilter,
    startDate: startDateFilter,
    endDate: endDateFilter,
    search: searchFilter
  });

  const handleApplyFilters = (e) => {
    e.preventDefault();
    fetchAuditLog(currentFilters());
  };

  const handleClearFilters = () => {
    setUsernameFilter('');
    setStartDateFilter('');
    setEndDateFilter('');
    setSearchFilter('');
    fetchAuditLog({ username: '', startDate: '', endDate: '', search: '' });
  };

  const handleRefresh = () => {
    fetchAuditLog(currentFilters());
  };

  const hasActiveFilters = usernameFilter || startDateFilter || endDateFilter || searchFilter;

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col overflow-hidden">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
          >
            <Home size={16} /> Início
          </button>
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <ScrollText size={22} /> Auditoria do Sistema
            </h1>
            <p className="text-slate-400 text-xs">
              Área restrita a administradores — histórico de alterações (últimos {rows.length >= 200 ? '200+' : rows.length} registros exibidos)
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => exportAuditToCSV(rows)}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            <Download size={14} className="text-amber-400" /> Exportar CSV
          </button>
          <button
            onClick={() => exportAuditToPDF(rows, currentFilters())}
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
          <label className="text-[11px] text-slate-400 font-semibold uppercase">Usuário</label>
          <input
            type="text"
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
            placeholder="Ex: joao"
            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500 w-32"
          />
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
            placeholder="Procura na ação e nos detalhes..."
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

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
            <Loader2 size={18} className="animate-spin" /> Carregando...
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-3 rounded">
            <AlertCircle size={14} className="shrink-0" /> {loadError}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">Nenhum registro de auditoria encontrado.</div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase">
                <th className="py-2.5 px-3">Data e Hora</th>
                <th className="py-2.5 px-3">Usuário</th>
                <th className="py-2.5 px-3">Perfil</th>
                <th className="py-2.5 px-3">Ação</th>
                <th className="py-2.5 px-3">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-2.5 px-3 text-slate-400 font-mono whitespace-nowrap">{row.formatted_date}</td>
                  <td className="py-2.5 px-3 font-semibold text-amber-400">{row.username}</td>
                  <td className="py-2.5 px-3 text-slate-400">{row.role || '—'}</td>
                  <td className="py-2.5 px-3">{row.action}</td>
                  <td className="py-2.5 px-3 text-slate-400">{formatDetails(row.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
