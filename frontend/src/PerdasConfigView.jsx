import React, { useState, useEffect } from 'react';
import api, { isOk } from './api';
import { Scale, Plus, Check, X, AlertTriangle } from 'lucide-react';

// Liga variáveis já cadastradas (tela de Variáveis) ao cálculo de Perdas —
// cada linha aqui vira um gráfico + um total em kg na tela de Perdas.
export default function PerdasConfigView({ onBack }) {
  const [availableFields, setAvailableFields] = useState([]);
  const [sensorConfigs, setSensorConfigs] = useState({});
  const [perdas, setPerdas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [novoField, setNovoField] = useState('');
  const [novoFator, setNovoFator] = useState(1);
  const [saving, setSaving] = useState(false);

  const carregar = () => {
    Promise.all([
      api.get('/api/influx/fields').catch(() => null),
      api.get('/api/config/sensores').catch(() => null),
      api.get('/api/config/perdas').catch(() => null)
    ]).then(([fieldsRes, sensorsRes, perdasRes]) => {
      if (fieldsRes && isOk(fieldsRes) && Array.isArray(fieldsRes.data)) setAvailableFields(fieldsRes.data);
      if (sensorsRes && isOk(sensorsRes)) setSensorConfigs(sensorsRes.data || {});
      if (perdasRes && isOk(perdasRes)) setPerdas(perdasRes.data || []);
      setLoading(false);
    });
  };

  useEffect(() => { carregar(); }, []);

  const fieldLabel = (field) => (sensorConfigs[field]?.descricao ? `${sensorConfigs[field].descricao} (${field})` : field);

  // Só oferece no seletor variáveis que ainda não estão vinculadas.
  const jaVinculadas = new Set(perdas.map((p) => p.fieldName));
  const disponiveisParaVincular = availableFields.filter((f) => !jaVinculadas.has(f));

  const handleAdicionar = async () => {
    if (!novoField) { setError('Selecione uma variável.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/config/perdas', {
        fieldName: novoField,
        descricao: sensorConfigs[novoField]?.descricao || novoField,
        fatorKg: Number(novoFator)
      });
      if (isOk(res)) {
        setNovoField('');
        setNovoFator(1);
        carregar();
      } else {
        setError(res.data?.error || 'Erro ao vincular variável.');
      }
    } catch (err) {
      setError('Erro ao vincular variável.');
    } finally {
      setSaving(false);
    }
  };

  const handleAtualizarFator = async (id, fatorKg) => {
    await api.put(`/api/config/perdas/${id}`, { fatorKg: Number(fatorKg) });
  };

  const handleToggleAtivo = async (p) => {
    await api.put(`/api/config/perdas/${p.id}`, { ativo: !p.ativo });
    carregar();
  };

  const handleRemover = async (p) => {
    if (!window.confirm(`Remover "${p.descricao}" das Perdas? O histórico da variável continua intacto — só o vínculo com a tela de Perdas some.`)) return;
    await api.delete(`/api/config/perdas/${p.id}`);
    carregar();
  };

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col gap-6 overflow-y-auto">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
            <Scale size={22} /> Parâmetros de Perdas
          </h1>
          <p className="text-slate-400 text-xs">Vincula variáveis já cadastradas ao cálculo de perdas em kg — área restrita a supervisores e administradores</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
        <p className="text-slate-400 text-xs">
          Cada variável vinculada aqui vira um gráfico e um total acumulado (em kg) por turno na tela de Perdas.
          A variável precisa ser um evento de pesagem (cada vez que o operador pesa um saco de rejeito, um registro novo
          é gravado nessa tag) — o total do turno é a SOMA de todas as pesagens que aconteceram dentro dele, não uma
          diferença entre início e fim. O "fator de conversão" transforma o valor bruto da tag em quilos (ex: tag já em
          kg → fator 1; tag em gramas → fator 0,001).
        </p>

        {error && (
          <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-200 text-xs rounded-lg px-4 py-2">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Vincular nova variável */}
        <div className="flex flex-wrap items-end gap-2 pb-4 border-b border-slate-700">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <label className="text-slate-400 text-xs font-semibold">Variável</label>
            <select
              value={novoField}
              onChange={(e) => setNovoField(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
            >
              <option value="">— selecione —</option>
              {disponiveisParaVincular.map((f) => (
                <option key={f} value={f}>{fieldLabel(f)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 w-40">
            <label className="text-slate-400 text-xs font-semibold">Fator → kg</label>
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              value={novoFator}
              onChange={(e) => setNovoFator(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            onClick={handleAdicionar}
            disabled={saving || !novoField}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
          >
            <Plus size={14} /> Vincular
          </button>
        </div>

        {/* Lista de vínculos atuais */}
        {loading ? (
          <p className="text-slate-500 text-sm">Carregando…</p>
        ) : perdas.length === 0 ? (
          <p className="text-slate-500 text-sm">Nenhuma variável vinculada às Perdas ainda.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {perdas.map((p) => (
              <div key={p.id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${p.ativo ? 'bg-slate-900/70' : 'bg-slate-900/30 opacity-50'}`}>
                <div className="flex-1 min-w-0">
                  <span className="text-slate-200 text-sm font-semibold truncate block">{p.descricao}</span>
                  <span className="text-slate-500 text-[11px] font-mono">{p.fieldName}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-[11px]">Fator:</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    defaultValue={p.fatorKg}
                    onBlur={(e) => handleAtualizarFator(p.id, e.target.value)}
                    className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 text-xs font-mono focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-slate-500 text-[11px]">kg</span>
                </div>
                <button
                  onClick={() => handleToggleAtivo(p)}
                  title={p.ativo ? 'Desativar' : 'Ativar'}
                  className={`p-1.5 rounded ${p.ativo ? 'text-emerald-400 hover:bg-red-900/40 hover:text-red-300' : 'text-slate-500 hover:bg-emerald-900/40 hover:text-emerald-300'}`}
                >
                  {p.ativo ? <Check size={14} /> : <X size={14} />}
                </button>
                <button
                  onClick={() => handleRemover(p)}
                  title="Remover vínculo"
                  className="p-1.5 rounded text-slate-500 hover:bg-red-900/40 hover:text-red-300"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-center text-slate-500 text-xs pb-2">
        Forno Industrial Dashboard — Módulo de Parâmetros de Perdas v1.0
      </div>
    </div>
  );
}
