import React from 'react';

// Gauges no estilo "painel industrial" (anel + meio-círculo com faixas
// vermelho/amarelo/verde) — layout copiado de um print de referência trazido
// pelo usuário na Fase 5. Ficam num arquivo próprio por serem puramente
// visuais/reutilizáveis: os valores e a lógica de "bom/ruim" continuam
// vindo de fora (calculados em OeeView.jsx), aqui só desenhamos.

// --- Anel do OEE: indicador principal, um único arco em gradiente
// laranja→vermelho (sem faixas de cor — é o resumo de tudo, já tem posição
// de destaque própria na tela).
export function OeeRingGauge({ value, label = 'OEE', size = 176 }) {
  const v = Math.min(100, Math.max(0, value || 0));
  const strokeWidth = 14;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (v / 100) * c;

  return (
    <div className="flex flex-col items-center shrink-0">
      <span className="text-amber-400 text-xs font-extrabold tracking-widest uppercase mb-1">{label}</span>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <defs>
            <linearGradient id="oeeRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e1b1e" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="url(#oeeRingGradient)" strokeWidth={strokeWidth}
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-4xl font-extrabold font-mono tracking-tight text-white">{Math.round(v)}%</span>
        </div>
      </div>
    </div>
  );
}

// --- Meio-círculo com faixas vermelho/amarelo/verde (Disponibilidade,
// Performance, Qualidade). As faixas são fixas (não dependem da meta do
// turno) de propósito — um gauge que muda de faixa toda vez que a meta é
// reconfigurada ficaria confuso; servem só de referência rápida de
// "ruim/ok/bom" nos patamares usuais de OEE.
const BANDAS = [
  { ate: 0.6, cor: '#ef4444' },
  { ate: 0.85, cor: '#eab308' },
  { ate: 1, cor: '#22c55e' },
];

function pontoNoArco(cx, cy, r, fracao) {
  const angulo = Math.PI - fracao * Math.PI; // 180° (esquerda) → 0° (direita), passando pelo topo
  return { x: cx + r * Math.cos(angulo), y: cy - r * Math.sin(angulo) };
}

function corDaFaixa(fracao) {
  return (BANDAS.find((b) => fracao <= b.ate) || BANDAS[BANDAS.length - 1]).cor;
}

export function HalfDonutGauge({ value, label, size = 132 }) {
  const v = Math.min(100, Math.max(0, value || 0));
  const fracao = v / 100;
  const strokeWidth = 14;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const corValor = corDaFaixa(fracao);

  // Ponteiro: risquinho branco cruzando a faixa exatamente na posição do
  // valor atual — dá uma leitura fina, além da faixa colorida grosseira.
  const angulo = Math.PI - fracao * Math.PI;
  const raioInterno = r - strokeWidth / 2 - 4;
  const raioExterno = r + strokeWidth / 2 + 4;
  const tick = {
    x1: cx + raioInterno * Math.cos(angulo), y1: cy - raioInterno * Math.sin(angulo),
    x2: cx + raioExterno * Math.cos(angulo), y2: cy - raioExterno * Math.sin(angulo)
  };

  let de = 0;
  const bandas = BANDAS.map((b) => {
    const p0 = pontoNoArco(cx, cy, r, de);
    const p1 = pontoNoArco(cx, cy, r, b.ate);
    de = b.ate;
    return { ...b, d: `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y}` };
  });

  return (
    <div className="flex flex-col items-center shrink-0">
      <svg width={size} height={size / 2 + 18} viewBox={`0 0 ${size} ${size / 2 + 18}`}>
        {bandas.map((b) => (
          <path key={b.cor} d={b.d} fill="none" stroke={b.cor} strokeWidth={strokeWidth} />
        ))}
        <line x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} stroke="#f8fafc" strokeWidth={3} strokeLinecap="round" />
      </svg>
      <span className="text-2xl font-extrabold font-mono -mt-1" style={{ color: corValor }}>{Math.round(v)}%</span>
      <span className="text-slate-300 text-xs font-semibold mt-0.5 text-center">{label}</span>
    </div>
  );
}
