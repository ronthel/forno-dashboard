import React, { useState, useEffect, useCallback } from 'react';
import api, { isOk } from './api';
import {
  Home, Save, Sliders, Database, Check, Layers, Palette,
  Plus, Trash2, Search, Loader2, X, AlertTriangle
} from 'lucide-react';

// Mesma paleta usada nos gráficos (ChartCard.jsx) — mantém consistência visual
// entre a cor escolhida aqui e a cor que a linha realmente usa no dashboard.
const COLOR_PALETTE = ['#38bdf8', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#eab308', '#f472b6', '#2dd4bf'];

// Escolhe a primeira cor da paleta que nenhuma variável já cadastrada está
// usando — evita que uma variável nova nasça com a mesma cor de outra já
// existente. Se todas as cores já estiverem em uso (mais de 8 variáveis),
// cicla pela paleta de novo em vez de travar.
function pickUnusedColor(sensorConfigs) {
  const usedColors = new Set(
    Object.values(sensorConfigs || {}).map((cfg) => cfg?.cor).filter(Boolean)
  );
  const free = COLOR_PALETTE.find((c) => !usedColors.has(c));
  if (free) return free;
  const count = Object.keys(sensorConfigs || {}).length;
  return COLOR_PALETTE[count % COLOR_PALETTE.length];
}

const DEFAULT_CONFIG_FOR = (field, sensorConfigs = {}) => ({
  descricao: `Sensor ${field}`,
  unidade: '°C',
  minLimit: 0,
  maxLimit: 100,
  cor: pickUnusedColor(sensorConfigs),
  fatorCorrecao: 1.0,
  tipoAlarme: 'Aviso'
});

export default function SensorConfigView({ onBack }) {
  const [availableFields, setAvailableFields] = useState([]);
  const [selectedField, setSelectedField] = useState('');
  const [sensorConfigs, setSensorConfigs] = useState({});

  // Filtro da lista de variáveis já cadastradas (ativas/desativadas) — busca
  // por nome da tag OU pela descrição, pra achar tanto quem lembra "CTP03"
  // quanto quem lembra "Temperatura Zona 3".
  const [fieldFilter, setFieldFilter] = useState('');

  const [currentConfig, setCurrentConfig] = useState(DEFAULT_CONFIG_FOR(''));

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [actionError, setActionError] = useState('');

  // --- Exclusão (soft-delete / desativação) ---
  const [confirmDeleteField, setConfirmDeleteField] = useState(null);
  const [busyField, setBusyField] = useState(null);

  // --- Painel "Adicionar nova variável" ---
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [plcSearch, setPlcSearch] = useState('');
  const [plcTags, setPlcTags] = useState(null); // null = ainda não carregado
  const [plcTagsLoading, setPlcTagsLoading] = useState(false);
  const [plcTagsError, setPlcTagsError] = useState('');
  const [manualFieldName, setManualFieldName] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      const [fieldsRes, configsRes] = await Promise.all([
        api.get('/api/influx/fields').catch(() => null),
        api.get('/api/config/sensores').catch(() => null)
      ]);

      const fieldsData = fieldsRes && isOk(fieldsRes) ? fieldsRes.data : [];
      const configsData = configsRes && isOk(configsRes) ? configsRes.data : {};
      const configs = configsData || {};

      // A lista de variáveis exibidas junta: tudo que já tem configuração
      // salva no PostgreSQL (ativas OU desativadas, para mostrar as duas
      // seções) + qualquer campo ativo que por algum motivo ainda não tenha
      // uma linha em sensores_config.
      const known = new Set(Object.keys(configs));
      (Array.isArray(fieldsData) ? fieldsData : []).forEach((f) => known.add(f));
      // Lista vazia é um estado real e válido (usuário pode ter excluído
      // todas as variáveis de propósito) — não inventa nomes fictícios aqui,
      // isso só escondia o fato de estar tudo excluído atrás de opções que
      // não existem mais no banco.
      const fields = Array.from(known);

      setAvailableFields(fields);
      setSensorConfigs(configs);

      setSelectedField((prev) => (prev && fields.includes(prev) ? prev : (fields[0] || '')));
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (selectedField && sensorConfigs[selectedField]) {
      setCurrentConfig(sensorConfigs[selectedField]);
    } else if (selectedField) {
      setCurrentConfig(DEFAULT_CONFIG_FOR(selectedField, sensorConfigs));
    }
  }, [selectedField, sensorConfigs]);

  const matchesFieldFilter = (field) => {
    const term = fieldFilter.trim().toLowerCase();
    if (!term) return true;
    const descricao = (sensorConfigs[field]?.descricao || '').toLowerCase();
    return field.toLowerCase().includes(term) || descricao.includes(term);
  };

  // Exclusão agora é definitiva (ver handleDelete) — não existe mais estado
  // "desativada" para separar numa segunda lista, é uma lista só.
  const activeFields = availableFields.filter(matchesFieldFilter);

  const handleSelectField = (field) => {
    setSelectedField(field);
    setConfirmDeleteField(null);
    if (sensorConfigs[field]) {
      setCurrentConfig(sensorConfigs[field]);
    } else {
      setCurrentConfig(DEFAULT_CONFIG_FOR(field, sensorConfigs));
    }
  };

  const handleChange = (key, value) => {
    setCurrentConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setActionError('');
    const updated = {
      ...sensorConfigs,
      [selectedField]: currentConfig
    };

    try {
      const res = await api.post('/api/config/sensores', updated);

      if (isOk(res)) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
        await fetchConfig();
      } else {
        setActionError(res.data?.error || 'Erro ao salvar sensor: sem permissão ou sessão expirada.');
      }
    } catch (err) {
      console.error('Erro ao salvar no banco:', err);
      setActionError('Erro ao salvar no banco.');
    }
  };

  // --- Excluir definitivamente ---
  const handleDelete = async (field) => {
    setBusyField(field);
    setActionError('');
    try {
      const res = await api.delete(`/api/config/sensores/${encodeURIComponent(field)}`);
      if (isOk(res)) {
        setConfirmDeleteField(null);
        await fetchConfig();
      } else {
        setActionError(res.data?.error || `Erro ao excluir "${field}".`);
      }
    } catch (err) {
      setActionError(`Erro ao excluir "${field}".`);
    } finally {
      setBusyField(null);
    }
  };

  // --- Descoberta de tags do PLC ---
  const loadPlcTags = useCallback(async () => {
    setPlcTagsLoading(true);
    setPlcTagsError('');
    try {
      const res = await api.get('/api/plc/tags');
      if (isOk(res)) {
        setPlcTags(Array.isArray(res.data?.atomic_scalar) ? res.data.atomic_scalar : []);
      } else {
        setPlcTagsError(res.data?.error || 'Não foi possível consultar as tags do PLC.');
        setPlcTags([]);
      }
    } catch (err) {
      setPlcTagsError('Não foi possível consultar as tags do PLC.');
      setPlcTags([]);
    } finally {
      setPlcTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showAddPanel && plcTags === null && !plcTagsLoading) {
      loadPlcTags();
    }
  }, [showAddPanel, plcTags, plcTagsLoading, loadPlcTags]);

  // Com centenas de tags de simulação misturadas às poucas tags reais do
  // forno, só mostramos resultado depois de pelo menos 2 caracteres
  // digitados, e limitamos a lista para não virar uma parede de texto.
  const searchTerm = plcSearch.trim().toLowerCase();
  const filteredPlcTags = searchTerm.length < 2
    ? []
    : (plcTags || [])
        .filter((t) => t.tag_name.toLowerCase().includes(searchTerm))
        .filter((t) => !availableFields.includes(t.tag_name))
        .slice(0, 30);

  const openNewFieldForm = (fieldName) => {
    if (!availableFields.includes(fieldName)) {
      setAvailableFields((prev) => [...prev, fieldName]);
    }
    setSelectedField(fieldName);
    setCurrentConfig(DEFAULT_CONFIG_FOR(fieldName, sensorConfigs));
    setShowAddPanel(false);
    setPlcSearch('');
    setManualFieldName('');
    setActionError('');
  };

  const handlePickPlcTag = (tagName) => {
    openNewFieldForm(tagName);
  };

  const handleManualAdd = () => {
    const name = manualFieldName.trim();
    if (!name) return;
    if (availableFields.includes(name)) {
      setActionError(`A variável "${name}" já existe na lista.`);
      return;
    }
    openNewFieldForm(name);
  };

  const closeAddPanel = () => {
    setShowAddPanel(false);
    setPlcSearch('');
    setManualFieldName('');
  };

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col justify-between overflow-hidden">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Sliders size={22} /> Configuração Avançada de Variáveis (PostgreSQL)
            </h1>
            <p className="text-slate-400 text-xs">Cadastre descrições, limites, unidades e formatação visual dos gráficos</p>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="max-w-6xl mx-auto w-full mt-4 flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-200 text-xs rounded-lg px-4 py-2">
          <AlertTriangle size={14} />
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="ml-auto text-red-300 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-auto max-w-6xl mx-auto w-full">
        {/* Coluna Esquerda: Lista de Variáveis */}
        <div className="lg:col-span-4 bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-700 pb-3">
            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Database size={16} className="text-amber-400" /> Variáveis
            </h2>
            <button
              type="button"
              onClick={() => setShowAddPanel(true)}
              className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition shadow"
            >
              <Plus size={14} /> Nova
            </button>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              placeholder="Filtrar por nome ou descrição..."
              className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-8 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            {fieldFilter && (
              <button
                type="button"
                onClick={() => setFieldFilter('')}
                title="Limpar filtro"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto max-h-[350px] pr-1">
            {activeFields.length === 0 ? (
              <span className="text-slate-500 text-xs text-center py-4">
                {fieldFilter ? 'Nenhuma variável ativa encontrada para esse filtro' : 'Nenhuma variável ativa'}
              </span>
            ) : (
              activeFields.map((field) => (
                <div
                  key={field}
                  className={`flex items-center gap-1 rounded-xl border transition ${
                    selectedField === field
                      ? 'bg-amber-600 border-amber-500 shadow-md'
                      : 'bg-slate-900/80 border-slate-700 hover:bg-slate-700/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectField(field)}
                    className={`flex-1 flex items-center justify-between p-3 text-left text-xs font-mono font-semibold ${
                      selectedField === field ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    <span>{field}</span>
                    <span className="text-[10px] opacity-75 uppercase">{sensorConfigs[field] ? 'Configurado' : 'Padrão'}</span>
                  </button>

                  {confirmDeleteField === field ? (
                    <div className="flex items-center gap-1 pr-2">
                      <button
                        type="button"
                        title="Excluir definitivamente (não pode ser desfeito)"
                        disabled={busyField === field}
                        onClick={() => handleDelete(field)}
                        className="text-[10px] font-bold bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded-lg disabled:opacity-50"
                      >
                        {busyField === field ? <Loader2 size={12} className="animate-spin" /> : 'Excluir'}
                      </button>
                      <button
                        type="button"
                        title="Cancelar"
                        onClick={() => setConfirmDeleteField(null)}
                        className="text-slate-300 hover:text-white p-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="Excluir variável definitivamente"
                      onClick={() => setConfirmDeleteField(field)}
                      className={`p-2 mr-1 rounded-lg transition ${
                        selectedField === field ? 'text-white/80 hover:bg-red-700/60' : 'text-slate-500 hover:text-red-400 hover:bg-slate-700'
                      }`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

        </div>

        {/* Coluna Direita: Formulário */}
        <form onSubmit={handleSave} className="lg:col-span-8 bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-5 flex items-center gap-2 border-b border-slate-700 pb-3">
              <Layers size={18} /> Editando Parâmetros do Sensor: <span className="text-white font-mono bg-slate-900 px-2 py-0.5 rounded">{selectedField || 'Nenhum'}</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-slate-400 text-xs font-semibold">Descrição Amigável:</label>
                <input
                  type="text"
                  value={currentConfig.descricao}
                  onChange={(e) => handleChange('descricao', e.target.value)}
                  placeholder="Ex: Temperatura da Zona 1"
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-slate-400 text-xs font-semibold">Unidade de Medida:</label>
                <input
                  type="text"
                  value={currentConfig.unidade}
                  onChange={(e) => handleChange('unidade', e.target.value)}
                  placeholder="Ex: °C, bar, RPM, %"
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-slate-400 text-xs font-semibold">Limite Mínimo (Alarme/Gráfico):</label>
                <input
                  type="number"
                  step="any"
                  value={currentConfig.minLimit}
                  onChange={(e) => handleChange('minLimit', Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-slate-400 text-xs font-semibold">Limite Máximo (Alarme/Gráfico):</label>
                <input
                  type="number"
                  step="any"
                  value={currentConfig.maxLimit}
                  onChange={(e) => handleChange('maxLimit', Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-slate-400 text-xs font-semibold">Fator de Correção (Multiplier):</label>
                <input
                  type="number"
                  step="0.01"
                  value={currentConfig.fatorCorrecao}
                  onChange={(e) => handleChange('fatorCorrecao', Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-slate-400 text-xs font-semibold flex items-center gap-1">
                  <Palette size={13} className="text-amber-400" /> Cor da Linha no Gráfico:
                </label>
                <div className="flex items-center gap-3 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5">
                  <input
                    type="color"
                    value={currentConfig.cor}
                    onChange={(e) => handleChange('cor', e.target.value)}
                    className="w-8 h-8 rounded bg-transparent cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300">{currentConfig.cor}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-5 mt-5 border-t border-slate-700">
            <button
              type="submit"
              disabled={!selectedField}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition shadow-lg disabled:opacity-50 ${
                savedSuccess ? 'bg-emerald-600 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
            >
              {savedSuccess ? <Check size={18} /> : <Save size={18} />}
              {savedSuccess ? 'Salvo no PostgreSQL!' : 'Salvar Configuração do Sensor'}
            </button>
          </div>
        </form>
      </div>

      <div className="text-center text-slate-500 text-xs pb-2">
        Forno Industrial Dashboard — Módulo de Configuração de Variáveis v1.0
      </div>

      {/* Painel: Adicionar nova variável (busca de tags do PLC) */}
      {showAddPanel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                <Plus size={16} /> Nova Variável
              </h3>
              <button type="button" onClick={closeAddPanel} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4 overflow-y-auto">
              <p className="text-slate-400 text-xs">
                Busque pelo nome da tag já existente no PLC (Studio 5000). Como o controlador tem muitas
                tags que não são do forno, digite ao menos 2 letras para ver os resultados.
              </p>

              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                <Search size={16} className="text-slate-500" />
                <input
                  type="text"
                  autoFocus
                  value={plcSearch}
                  onChange={(e) => setPlcSearch(e.target.value)}
                  placeholder="Buscar tag no PLC (ex: CTP, TEMP...)"
                  className="bg-transparent flex-1 text-sm text-slate-100 focus:outline-none"
                />
                {plcTagsLoading && <Loader2 size={16} className="text-slate-500 animate-spin" />}
              </div>

              {plcTagsError ? (
                <div className="text-xs text-amber-300 bg-amber-900/30 border border-amber-800 rounded-lg p-3">
                  {plcTagsError} Você ainda pode cadastrar a variável digitando o nome manualmente abaixo.
                </div>
              ) : (
                <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
                  {searchTerm.length < 2 ? (
                    <span className="text-slate-500 text-xs text-center py-3">Digite para buscar entre as tags do PLC...</span>
                  ) : plcTagsLoading ? (
                    <span className="text-slate-500 text-xs text-center py-3">Carregando tags do PLC...</span>
                  ) : filteredPlcTags.length === 0 ? (
                    <span className="text-slate-500 text-xs text-center py-3">Nenhuma tag encontrada para "{plcSearch}".</span>
                  ) : (
                    filteredPlcTags.map((tag) => (
                      <button
                        key={tag.tag_name}
                        type="button"
                        onClick={() => handlePickPlcTag(tag.tag_name)}
                        className="flex items-center justify-between text-left bg-slate-900/70 hover:bg-amber-600/90 hover:text-white border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 transition"
                      >
                        <span>{tag.tag_name}</span>
                        <span className="text-[10px] opacity-70 uppercase">{tag.data_type}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="border-t border-slate-700 pt-4 flex flex-col gap-2">
                <label className="text-slate-400 text-xs font-semibold">
                  Ou, se souber o nome exato da tag (útil se a lista do PLC não estiver disponível agora):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualFieldName}
                    onChange={(e) => setManualFieldName(e.target.value)}
                    placeholder="Nome exato da tag no PLC"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={handleManualAdd}
                    disabled={!manualFieldName.trim()}
                    className="bg-slate-700 hover:bg-amber-600 text-slate-100 hover:text-white text-xs font-bold px-3 py-2 rounded-lg transition disabled:opacity-40"
                  >
                    Usar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
