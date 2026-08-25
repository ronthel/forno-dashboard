import React, { useState, useEffect } from 'react';
import api, { isOk } from './api';
import { Home, Save, Settings, Clock, Target, Check, Gauge, AlertTriangle } from 'lucide-react';

const EMPTY_OEE_CONFIG = {
  fieldTempoRodando: '', fieldContagemTotal: '', fieldContagemRefugo: '',
  fieldMaquinaRodando: '', fieldVelocidadeNominal: '', fieldVelocidadeReal: '',
  velocidadeNominalPpm: 50, tempoPlanejadoSeg: 28800
};

export default function ConfigView({ onBack }) {
  const [turnosConfig, setTurnosConfig] = useState({
    turnoA: { nome: 'Turno A', inicio: '06:00', fim: '14:00', metaOee: 80 },
    turnoB: { nome: 'Turno B (Atual)', inicio: '14:00', fim: '22:00', metaOee: 80 },
    turnoC: { nome: 'Turno C', inicio: '22:00', fim: '06:00', metaOee: 80 },
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  // --- Mapeamento de variáveis do OEE ---
  const [availableFields, setAvailableFields] = useState([]);
  const [sensorConfigs, setSensorConfigs] = useState({});
  const [oeeConfig, setOeeConfig] = useState(EMPTY_OEE_CONFIG);
  const [oeeSavedSuccess, setOeeSavedSuccess] = useState(false);
  const [oeeError, setOeeError] = useState('');

  // Carregar do PostgreSQL ao abrir
  useEffect(() => {
    api.get('/api/config/turnos')
      .then((res) => res.data)
      .then((data) => {
        if (data && Object.keys(data).length > 0) {
          setTurnosConfig(data);
        }
      })
      .catch((err) => console.error('Erro ao carregar turnos do banco:', err));

    // Variáveis disponíveis pra popular os seletores do mapeamento do OEE —
    // mesma fonte usada no resto do sistema (Historian via InfluxDB + nomes
    // amigáveis de sensores_config).
    Promise.all([
      api.get('/api/influx/fields').catch(() => null),
      api.get('/api/config/sensores').catch(() => null)
    ]).then(([fieldsRes, configsRes]) => {
      if (fieldsRes && isOk(fieldsRes) && Array.isArray(fieldsRes.data)) {
        setAvailableFields(fieldsRes.data);
      }
      if (configsRes && isOk(configsRes)) {
        setSensorConfigs(configsRes.data || {});
      }
    });

    api.get('/api/config/oee')
      .then((res) => {
        if (isOk(res)) {
          setOeeConfig({
            fieldTempoRodando: res.data.fieldTempoRodando || '',
            fieldContagemTotal: res.data.fieldContagemTotal || '',
            fieldContagemRefugo: res.data.fieldContagemRefugo || '',
            fieldMaquinaRodando: res.data.fieldMaquinaRodando || '',
            fieldVelocidadeNominal: res.data.fieldVelocidadeNominal || '',
            fieldVelocidadeReal: res.data.fieldVelocidadeReal || '',
            velocidadeNominalPpm: res.data.velocidadeNominalPpm ?? 50,
            tempoPlanejadoSeg: res.data.tempoPlanejadoSeg ?? 28800
          });
        }
      })
      .catch((err) => console.error('Erro ao carregar config do OEE:', err));
  }, []);

  const handleOeeChange = (field, value) => {
    setOeeConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveOee = (e) => {
    e.preventDefault();
    setOeeError('');
    api.post('/api/config/oee', oeeConfig)
      .then((res) => {
        if (isOk(res)) {
          setOeeSavedSuccess(true);
          setTimeout(() => setOeeSavedSuccess(false), 3000);
        } else {
          setOeeError(res.data?.error || 'Erro ao salvar: sem permissão ou sessão expirada.');
        }
      })
      .catch(() => setOeeError('Erro ao salvar configuração do OEE.'));
  };

  const fieldLabel = (field) => (sensorConfigs[field]?.descricao ? `${sensorConfigs[field].descricao} (${field})` : field);

  const handleChange = (turnoKey, field, value) => {
    setTurnosConfig((prev) => ({
      ...prev,
      [turnoKey]: {
        ...prev[turnoKey],
        [field]: value,
      },
    }));
  };

  const handleSave = (e) => {
    e.preventDefault();
    api.post('/api/config/turnos', turnosConfig)
      .then((res) => {
        if (isOk(res)) {
          setSavedSuccess(true);
          setTimeout(() => setSavedSuccess(false), 3000);
        } else {
          console.error('Erro ao salvar turnos: sem permissão ou sessão expirada.');
        }
      })
      .catch((err) => console.error('Erro ao salvar turnos no banco:', err));
  };

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100 p-6 flex flex-col gap-6 overflow-y-auto">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
              <Settings size={22} /> Configuração de Turnos e Metas de OEE (PostgreSQL)
            </h1>
            <p className="text-slate-400 text-xs">Área restrita para supervisores e administradores da linha</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="my-auto max-w-4xl mx-auto w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-xl">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-6 flex items-center gap-2">
          <Clock size={18} className="text-amber-400" /> Parâmetros Operacionais por Turno
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {Object.keys(turnosConfig).map((key) => {
            const turno = turnosConfig[key];
            return (
              <div key={key} className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 shadow-inner flex flex-col gap-4">
                <h3 className="text-amber-400 font-bold text-sm uppercase tracking-wide border-b border-slate-800 pb-2">
                  {turno.nome}
                </h3>

                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-400 text-xs font-semibold">Hora de Início:</label>
                  <input
                    type="time"
                    value={turno.inicio}
                    onChange={(e) => handleChange(key, 'inicio', e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-400 text-xs font-semibold">Hora de Término:</label>
                  <input
                    type="time"
                    value={turno.fim}
                    onChange={(e) => handleChange(key, 'fim', e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-400 text-xs font-semibold flex items-center gap-1">
                    <Target size={13} className="text-emerald-400" /> Meta OEE (%):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={turno.metaOee}
                    onChange={(e) => handleChange(key, 'metaOee', Number(e.target.value))}
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button
            type="submit"
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition shadow-lg ${
              savedSuccess ? 'bg-emerald-600 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {savedSuccess ? <Check size={18} /> : <Save size={18} />}
            {savedSuccess ? 'Salvo no PostgreSQL!' : 'Salvar Alterações'}
          </button>
        </div>
      </form>

      <form onSubmit={handleSaveOee} className="max-w-4xl mx-auto w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-xl">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
          <Gauge size={18} className="text-amber-400" /> Mapeamento de Variáveis do OEE
        </h2>
        <p className="text-slate-400 text-xs mb-6">
          O cálculo do OEE usa as variáveis abaixo, escolhidas entre as já cadastradas na tela de Variáveis —
          nada de nome de tag fixo no código. Cadastre a tag no Historian primeiro, depois volte aqui pra apontar
          pra ela.
        </p>

        {oeeError && (
          <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-200 text-xs rounded-lg px-4 py-2 mb-4">
            <AlertTriangle size={14} />
            <span>{oeeError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {[
            { key: 'fieldTempoRodando', label: 'Tempo Rodando (obrigatório)', hint: 'Tempo total rodando/produzindo, em segundos — crescente, nunca zera' },
            { key: 'fieldContagemTotal', label: 'Contagem Total (obrigatório)', hint: 'Peças/lotes produzidos — crescente, nunca zera' },
            { key: 'fieldContagemRefugo', label: 'Contagem de Refugo', hint: 'Peças/lotes rejeitados — crescente, nunca zera. Boas = Total − Refugo' },
            { key: 'fieldMaquinaRodando', label: 'Máquina Rodando (opcional)', hint: 'Status instantâneo (0/1) — só exibido, não entra na conta' },
            { key: 'fieldVelocidadeNominal', label: 'Velocidade Nominal (opcional)', hint: 'Setpoint de velocidade da linha (pacotes/min), vindo do CLP — se mapeada, substitui o número fixo abaixo' },
            { key: 'fieldVelocidadeReal', label: 'Velocidade Real (opcional)', hint: 'Velocidade instantânea (pacotes/min) já calculada pelo CLP — se mapeada, substitui o cálculo por Contagem Total' },
          ].map(({ key, label, hint }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-semibold">{label}</label>
              <select
                value={oeeConfig[key] || ''}
                onChange={(e) => handleOeeChange(key, e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">— não mapeada —</option>
                {availableFields.map((f) => (
                  <option key={f} value={f}>{fieldLabel(f)}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">{hint}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 pt-4 border-t border-slate-700">
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 text-xs font-semibold">Velocidade Nominal — reserva (pacotes/min)</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={oeeConfig.velocidadeNominalPpm}
              onChange={(e) => handleOeeChange('velocidadeNominalPpm', Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
              required
            />
            <p className="text-[11px] text-slate-500">
              Usada como referência 100% na Performance. Só entra em uso se a variável "Velocidade Nominal" acima não
              estiver mapeada — quando estiver, o valor vem do CLP e este número aqui é ignorado.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 text-xs font-semibold">Janela de Cálculo — reserva (segundos)</label>
            <input
              type="number"
              min="60"
              step="60"
              value={oeeConfig.tempoPlanejadoSeg}
              onChange={(e) => handleOeeChange('tempoPlanejadoSeg', Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 text-sm font-mono focus:outline-none focus:border-amber-500"
              required
            />
            <p className="text-[11px] text-slate-500">
              O tempo planejado normalmente vem do turno configurado acima (Parâmetros Operacionais por Turno),
              detectado automaticamente pelo horário atual. Isso aqui só é usado se nenhum turno cobrir o
              horário de agora, ou se nenhum turno tiver sido salvo ainda.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button
            type="submit"
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition shadow-lg ${
              oeeSavedSuccess ? 'bg-emerald-600 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {oeeSavedSuccess ? <Check size={18} /> : <Save size={18} />}
            {oeeSavedSuccess ? 'Salvo no PostgreSQL!' : 'Salvar Mapeamento'}
          </button>
        </div>
      </form>

      <div className="text-center text-slate-500 text-xs pb-2">
        Forno Industrial Dashboard — Módulo de Configuração de Turnos v1.0
      </div>
    </div>
  );
}