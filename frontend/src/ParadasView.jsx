import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Clock, CheckCircle2, RefreshCw } from 'lucide-react';
import api, { isOk } from './api';

function formatDuracao(iniciadoEm, finalizadoEm) {
  const inicio = new Date(iniciadoEm).getTime();
  const fim = finalizadoEm ? new Date(finalizadoEm).getTime() : Date.now();
  const totalSeg = Math.max(0, Math.round((fim - inicio) / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return min > 0 ? `${min}min ${seg}s` : `${seg}s`;
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

export default function ParadasView({ onBack }) {
  const [motivos, setMotivos] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const [motivosRes, pendentesRes, historicoRes] = await Promise.all([
        api.get('/api/paradas/motivos'),
        api.get('/api/paradas', { params: { status: 'pendentes' } }),
        api.get('/api/paradas', { params: { limit: 30 } }),
      ]);
      if (isOk(motivosRes)) setMotivos(motivosRes.data);
      if (isOk(pendentesRes)) setPendentes(pendentesRes.data);
      if (isOk(historicoRes)) setHistorico(historicoRes.data);
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
        <button
          onClick={carregar}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow"
        >
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

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

      <div>
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">Histórico recente</h2>
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl overflow-hidden">
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
