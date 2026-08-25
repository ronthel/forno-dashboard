import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Clock, CheckCircle2, RefreshCw, Download, Settings, BarChart3, Plus, Check, X } from 'lucide-react';
import api, { isOk } from './api';

const ABERTA_ALERTA_MIN = 15; // parada aberta (sem terminar) há mais tempo que isso vira alerta vermelho

function formatDuracaoSeg(totalSeg) {
  const seg = Math.max(0, Math.round(totalSeg));
  const h = Math.floor(seg / 3600);
  const min = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) return `${h}h ${min}min`;
  if (min > 0) return `${min}min ${s}s`;
  return `${s}s`;
}

function formatDuracao(iniciadoEm, finalizadoEm) {
  const inicio = new Date(iniciadoEm).getTime();
  const fim = finalizadoEm ? new Date(finalizadoEm).getTime() : Date.now();
  return formatDuracaoSeg((fim - inicio) / 1000);
}

function formatHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Um item pendente de classificação — motivo + justificativa, salvos juntos.
function ParadaPendenteCard({ parada, motivos, onClassificado }) {
  const [motivoId, setMotivoId] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const programados = motivos.filter((m) => m.tipo === 'programada' && m.ativo);
  const naoProgramados = motivos.filter((m) => m.tipo === 'nao_programada' && m.ativo);

  const handleSalvar = async () => {
    if (!motivoId) { setError('Selecione um motivo.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/api/paradas/${parada.id}/classificar`, { motivoId: Number(motivoId), justificativa });
      if (isOk(res)) {
        onClassificado(parada.id);
      } else {
        setError(res.data?.error || 'Erro ao salvar.');
      }
    } catch (err) {
      setError('Erro ao salvar classificação.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800/90 border border-amber-600/50 rounded-xl p-4 shadow-md flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wide">
          <AlertTriangle size={14} /> Parada sem classificação
        </div>
        <span className="text-slate-400 text-xs font-mono">{formatDuracao(parada.iniciado_em, parada.finalizado_em)}</span>
      </div>
      <p className="text-slate-300 text-xs font-mono">
        {formatHora(parada.iniciado_em)} → {formatHora(parada.finalizado_em)}
      </p>

      {error && <p className="text-red-300 text-xs">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={motivoId}
          onChange={(e) => setMotivoId(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
        >
          <option value="">Selecione o motivo…</option>
          <optgroup label="Programada">
            {programados.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </optgroup>
          <optgroup label="Não programada">
            {naoProgramados.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </optgroup>
        </select>
        <input
          type="text"
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Justificativa (opcional)"
          maxLength={300}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
        />
      </div>

      <button
        onClick={handleSalvar}
        disabled={saving}
        className="self-end flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'Classificar'}
      </button>
    </div>
  );
}

// Painel de administração do catálogo de motivos — criar novo, ativar/desativar.
function MotivosManager({ motivos, onChanged, onClose }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('nao_programada');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCriar = async () => {
    if (!nome.trim()) { setError('Informe o nome.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/paradas/motivos', { nome: nome.trim(), tipo });
      if (isOk(res)) {
        setNome('');
        onChanged();
      } else {
        setError(res.data?.error || 'Erro ao criar motivo.');
      }
    } catch (err) {
      setError('Erro ao criar motivo.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAtivo = async (motivo) => {
    await api.put(`/api/paradas/motivos/${motivo.id}`, { ativo: !motivo.ativo });
    onChanged();
  };

  return (
    <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-md flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Settings size={16} className="text-amber-400" /> Motivos de Parada (catálogo)
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>

      {error && <p className="text-red-300 text-xs">{error}</p>}

      <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
        {motivos.map((m) => (
          <div key={m.id} className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs ${m.ativo ? 'bg-slate-900/70' : 'bg-slate-900/30 opacity-50'}`}>
            <span className="text-slate-200">{m.nome}</span>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.tipo === 'programada' ? 'bg-sky-950/60 text-sky-400' : 'bg-red-950/60 text-red-400'}`}>
                {m.tipo === 'programada' ? 'Programada' : 'Não programada'}
              </span>
              <button
                onClick={() => handleToggleAtivo(m)}
                title={m.ativo ? 'Desativar' : 'Ativar'}
                className={`p-1 rounded ${m.ativo ? 'text-emerald-400 hover:bg-red-900/40 hover:text-red-300' : 'text-slate-500 hover:bg-emerald-900/40 hover:text-emerald-300'}`}
              >
                {m.ativo ? <Check size={13} /> : <X size={13} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-slate-700">
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Novo motivo…"
          maxLength={100}
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-xs focus:outline-none focus:border-amber-500"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 text-xs focus:outline-none"
        >
          <option value="nao_programada">Não programada</option>
          <option value="programada">Programada</option>
        </select>
        <button
          onClick={handleCriar}
          disabled={saving}
          className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition disabled:opacity-50"
        >
          <Plus size={13} /> Criar
        </button>
      </div>
    </div>
  );
}

function exportarCsv(historico) {
  if (historico.length === 0) return;
  const header = ['Início', 'Fim', 'Duração (s)', 'Motivo', 'Tipo', 'Justificativa', 'Classificado por'].join(';');
  const linhas = historico.map((p) => [
    formatHora(p.iniciado_em),
    p.finalizado_em ? formatHora(p.finalizado_em) : '',
    p.finalizado_em ? Math.round((new Date(p.finalizado_em) - new Date(p.iniciado_em)) / 1000) : '',
    p.motivo_nome || '',
    p.motivo_tipo || '',
    (p.justificativa || '').replace(/;/g, ','),
    p.classificado_por_username || ''
  ].join(';'));
  const csv = `${header}\n${linhas.join('\n')}`;
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `paradas_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ParadasView({ onBack, canConfig }) {
  const [motivos, setMotivos] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [abertas, setAbertas] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [pareto, setPareto] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMotivos, setShowMotivos] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [motivosRes, pendentesRes, abertasRes, historicoRes, paretoRes] = await Promise.all([
        api.get('/api/paradas/motivos'),
        api.get('/api/paradas', { params: { status: 'pendentes' } }),
        api.get('/api/paradas', { params: { status: 'abertas' } }),
        api.get('/api/paradas', { params: { limit: 50 } }),
        api.get('/api/paradas/pareto', { params: { dias: 30 } }),
      ]);
      if (isOk(motivosRes)) setMotivos(motivosRes.data);
      if (isOk(pendentesRes)) setPendentes(pendentesRes.data);
      if (isOk(abertasRes)) setAbertas(abertasRes.data);
      if (isOk(historicoRes)) setHistorico(historicoRes.data);
      if (isOk(paretoRes)) setPareto(paretoRes.data);
    } catch (err) {
      console.error('Erro ao carregar paradas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const interval = setInterval(carregar, 15000);
    return () => clearInterval(interval);
  }, [carregar]);

  const handleClassificado = (id) => {
    setPendentes((prev) => prev.filter((p) => p.id !== id));
    carregar();
  };

  const abertaAlerta = abertas.find((p) => (Date.now() - new Date(p.iniciado_em).getTime()) / 60000 >= ABERTA_ALERTA_MIN);
  const maiorTotalSeg = pareto?.porMotivo?.length > 0 ? Math.max(...pareto.porMotivo.map((m) => m.totalSeg)) : 0;

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col gap-6 overflow-y-auto">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
            <Clock size={22} /> Paradas da Linha
          </h1>
          <p className="text-slate-400 text-xs">
            Detectadas automaticamente pela variável "Máquina Rodando" — classifique o motivo de cada uma
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canConfig && (
            <button
              onClick={() => setShowMotivos((v) => !v)}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
            >
              <Settings size={14} /> Motivos
            </button>
          )}
          <button
            onClick={carregar}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {abertaAlerta && (
        <div className="bg-red-950/50 border border-red-700 text-red-200 text-xs rounded-lg px-4 py-2.5 flex items-center gap-2 animate-pulse">
          <AlertTriangle size={16} />
          A linha está parada há <strong>{formatDuracao(abertaAlerta.iniciado_em, null)}</strong> (desde {formatHora(abertaAlerta.iniciado_em)}) e ainda não voltou a rodar.
        </div>
      )}

      {showMotivos && canConfig && (
        <MotivosManager motivos={motivos} onChanged={carregar} onClose={() => setShowMotivos(false)} />
      )}

      <div>
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">
          Pendentes de classificação {pendentes.length > 0 && `(${pendentes.length})`}
        </h2>
        {loading ? (
          <p className="text-slate-500 text-sm">Carregando…</p>
        ) : pendentes.length === 0 ? (
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-slate-400 text-sm flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400" /> Nenhuma parada esperando classificação.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendentes.map((p) => (
              <ParadaPendenteCard key={p.id} parada={p} motivos={motivos} onClassificado={handleClassificado} />
            ))}
          </div>
        )}
      </div>

      {/* Pareto + MTBF/MTTR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-md">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BarChart3 size={16} className="text-amber-400" /> Pareto de Paradas (últimos 30 dias)
          </h2>
          {!pareto || pareto.porMotivo.length === 0 ? (
            <p className="text-slate-500 text-xs">Nenhuma parada classificada nos últimos 30 dias ainda.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pareto.porMotivo.map((m) => (
                <div key={m.motivoId} className="flex flex-col gap-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-200">{m.nome} <span className="text-slate-500">({m.quantidade}x)</span></span>
                    <span className="text-slate-400 font-mono">{formatDuracaoSeg(m.totalSeg)}</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${m.tipo === 'programada' ? 'bg-sky-500' : 'bg-red-500'}`}
                      style={{ width: `${maiorTotalSeg > 0 ? (m.totalSeg / maiorTotalSeg) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-md">
            <span className="text-slate-400 text-[11px] font-semibold uppercase">MTTR — tempo médio de reparo</span>
            <h2 className="text-2xl font-bold text-amber-400 font-mono mt-0.5">
              {pareto?.mttrSeg != null ? formatDuracaoSeg(pareto.mttrSeg) : '—'}
            </h2>
          </div>
          <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 shadow-md">
            <span className="text-slate-400 text-[11px] font-semibold uppercase">MTBF — tempo médio entre falhas</span>
            <h2 className="text-2xl font-bold text-emerald-400 font-mono mt-0.5">
              {pareto?.mtbfSeg != null ? formatDuracaoSeg(pareto.mtbfSeg) : '—'}
            </h2>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Histórico recente</h2>
          <button
            onClick={() => exportarCsv(historico)}
            disabled={historico.length === 0}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow disabled:opacity-40"
          >
            <Download size={14} /> Exportar CSV
          </button>
        </div>
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Início</th>
                <th className="text-left px-3 py-2">Duração</th>
                <th className="text-left px-3 py-2">Motivo</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Justificativa</th>
                <th className="text-left px-3 py-2">Classificado por</th>
              </tr>
            </thead>
            <tbody>
              {historico.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-slate-500 py-6">Nenhuma parada registrada ainda.</td></tr>
              ) : historico.map((p) => (
                <tr key={p.id} className="border-t border-slate-700/60">
                  <td className="px-3 py-2 font-mono text-slate-300">{formatHora(p.iniciado_em)}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{formatDuracao(p.iniciado_em, p.finalizado_em)}</td>
                  <td className="px-3 py-2 text-slate-200">{p.motivo_nome || <span className="text-amber-400">sem motivo</span>}</td>
                  <td className="px-3 py-2">
                    {p.motivo_tipo && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        p.motivo_tipo === 'programada' ? 'bg-sky-950/60 text-sky-400' : 'bg-red-950/60 text-red-400'
                      }`}>
                        {p.motivo_tipo === 'programada' ? 'Programada' : 'Não programada'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{p.justificativa || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{p.classificado_por_username || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
