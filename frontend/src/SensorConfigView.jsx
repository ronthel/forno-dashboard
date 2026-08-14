import React, { useState, useEffect, useCallback } from 'react';
import api, { isOk } from './api';
import { Home, Save, Sliders, Database, Check, Layers, Palette } from 'lucide-react';

export default function SensorConfigView({ onBack }) {
  const [availableFields, setAvailableFields] = useState([]);
  const [selectedField, setSelectedField] = useState('');
  const [sensorConfigs, setSensorConfigs] = useState({});
  
  const [currentConfig, setCurrentConfig] = useState({
    descricao: '',
    unidade: '°C',
    minLimit: 0,
    maxLimit: 100,
    cor: '#38bdf8',
    fatorCorrecao: 1.0,
    tipoAlarme: 'Aviso'
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const [fieldsRes, configsRes] = await Promise.all([
        api.get('/api/influx/fields').catch(() => null),
        api.get('/api/config/sensores').catch(() => null)
      ]);

      const fieldsData = fieldsRes && isOk(fieldsRes) ? fieldsRes.data : [];
      const configsData = configsRes && isOk(configsRes) ? configsRes.data : {};

      let fields = Array.isArray(fieldsData) ? fieldsData : [];
      const configs = configsData || {};

      if (fields.length === 0 && Object.keys(configs).length > 0) {
        fields = Object.keys(configs);
      }
      if (fields.length === 0) {
        fields = ['CTP01', 'CTC'];
      }

      setAvailableFields(fields);
      setSensorConfigs(configs);

      if (fields.length > 0 && !selectedField) {
        setSelectedField(fields[0]);
      }
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    }
  }, [selectedField]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (selectedField && sensorConfigs[selectedField]) {
      setCurrentConfig(sensorConfigs[selectedField]);
    } else if (selectedField) {
      setCurrentConfig({
        descricao: `Sensor ${selectedField}`,
        unidade: '°C',
        minLimit: 0,
        maxLimit: 100,
        cor: '#38bdf8',
        fatorCorrecao: 1.0,
        tipoAlarme: 'Aviso'
      });
    }
  }, [selectedField, sensorConfigs]);

  const handleSelectField = (field) => {
    setSelectedField(field);
    if (sensorConfigs[field]) {
      setCurrentConfig(sensorConfigs[field]);
    } else {
      setCurrentConfig({
        descricao: `Sensor ${field}`,
        unidade: '°C',
        minLimit: 0,
        maxLimit: 100,
        cor: '#38bdf8',
        fatorCorrecao: 1.0,
        tipoAlarme: 'Aviso'
      });
    }
  };

  const handleChange = (key, value) => {
    setCurrentConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const updated = {
      ...sensorConfigs,
      [selectedField]: currentConfig
    };
    
    try {
      const res = await api.post('/api/config/sensores', updated);

      if (isOk(res)) {
        setSensorConfigs(updated);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
        await fetchConfig();
      } else {
        console.error('Erro ao salvar sensor: sem permissão ou sessão expirada.');
      }
    } catch (err) {
      console.error('Erro ao salvar no banco:', err);
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-100 p-6 flex flex-col justify-between overflow-hidden">
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
              <Sliders size={22} /> Configuração Avançada de Variáveis (PostgreSQL)
            </h1>
            <p className="text-slate-400 text-xs">Cadastre descrições, limites, unidades e formatação visual dos gráficos</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-auto max-w-6xl mx-auto w-full">
        {/* Coluna Esquerda: Lista de Variáveis */}
        <div className="lg:col-span-4 bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 border-b border-slate-700 pb-3">
            <Database size={16} className="text-amber-400" /> Variáveis Disponíveis
          </h2>

          <div className="flex flex-col gap-2 overflow-y-auto max-h-[350px] pr-1">
            {availableFields.length === 0 ? (
              <span className="text-slate-500 text-xs text-center py-4">Nenhuma variável encontrada</span>
            ) : (
              availableFields.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => handleSelectField(field)}
                  className={`flex items-center justify-between p-3 rounded-xl text-left text-xs font-mono font-semibold transition border ${
                    selectedField === field
                      ? 'bg-amber-600 text-white border-amber-500 shadow-md'
                      : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-700/60'
                  }`}
                >
                  <span>{field}</span>
                  <span className="text-[10px] opacity-75 uppercase">{sensorConfigs[field] ? 'Configurado' : 'Padrão'}</span>
                </button>
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
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition shadow-lg ${
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
    </div>
  );
}