import React, { useState } from 'react';

// Linha do tempo visual do turno inteiro: a barra representa o turno
// completo (início programado → fim programado), da esquerda pra direita.
// Começa vazia e vai enchendo de verde (produzindo) / vermelho (parado) à
// medida que o tempo passa — o trecho ainda não vivido fica em branco. A
// largura de cada bloco é proporcional à duração REAL dele dentro do turno
// inteiro (não só entre os blocos já existentes), então a barra sempre
// representa fielmente "quanto do turno já passou" e "quanto falta".

function formatarDuracaoCurta(totalSegundos) {
  const s = Math.max(0, Math.round(totalSegundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${sec}s`;
  return `${sec}s`;
}

function formatarHora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ProductionTimeline({ blocos, inicio, fimProgramado }) {
  const [hoverKey, setHoverKey] = useState(null);

  if (!inicio || !fimProgramado) {
    return (
      <div className="h-6 rounded-lg bg-slate-900/70 border border-slate-700/60 flex items-center justify-center text-[11px] text-slate-500">
        Sem dados de produção nesse turno ainda
      </div>
    );
  }

  const inicioMs = new Date(inicio).getTime();
  const fimMs = new Date(fimProgramado).getTime();
  const totalSeg = Math.max(1, (fimMs - inicioMs) / 1000);

  // Trecho do turno que ainda não aconteceu (fica em branco) — do fim do
  // último bloco real até o fim programado do turno. Se o turno já
  // terminou, isso dá zero (barra fica 100% preenchida).
  const ultimoFimMs = blocos.length > 0 ? new Date(blocos[blocos.length - 1].fim).getTime() : inicioMs;
  const futuroSeg = Math.max(0, (fimMs - ultimoFimMs) / 1000);

  const totais = blocos.reduce(
    (acc, b) => {
      if (b.status === 'rodando') acc.produzindoSeg += b.duracaoSeg;
      else acc.paradoSeg += b.duracaoSeg;
      return acc;
    },
    { produzindoSeg: 0, paradoSeg: 0 }
  );
  const decorridoSeg = totais.produzindoSeg + totais.paradoSeg;
  const pctProduzindo = decorridoSeg > 0 ? (totais.produzindoSeg / decorridoSeg) * 100 : 0;
  const pctParado = decorridoSeg > 0 ? (totais.paradoSeg / decorridoSeg) * 100 : 0;

  // Arredondamento das pontas feito manualmente por classe (em vez de
  // overflow-hidden no container) — overflow-hidden cortaria a dica do
  // hover, que aparece ACIMA do bloco (fora da altura de 24px da barra).
  const semFuturo = futuroSeg <= 0;

  return (
    <div>
      <div className="flex h-6 rounded-lg border border-slate-700/60 shadow-inner bg-slate-900/70">
        {blocos.map((b, i) => {
          const isParada = b.status === 'parada';
          const widthPct = (b.duracaoSeg / totalSeg) * 100;
          const key = `b${i}`;
          const isPrimeiro = i === 0;
          const isUltimoVisivel = semFuturo && i === blocos.length - 1;
          return (
            <div
              key={key}
              className={`relative h-full cursor-default hover:brightness-110 transition ${
                isPrimeiro ? 'rounded-l-lg' : ''
              } ${isUltimoVisivel ? 'rounded-r-lg' : ''} ${
                i > 0 ? 'border-l border-slate-900/50' : ''
              } ${
                isParada ? (b.emAberto ? 'bg-red-600 animate-pulse' : 'bg-red-500/90') : 'bg-emerald-500/90'
              }`}
              style={{ width: `${widthPct}%`, minWidth: widthPct > 0 ? '1px' : 0 }}
              onMouseEnter={() => setHoverKey(key)}
              onMouseLeave={() => setHoverKey((cur) => (cur === key ? null : cur))}
            >
              {hoverKey === key && (
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap bg-slate-900 border border-slate-600 text-slate-100 text-[11px] rounded-md px-2.5 py-1.5 shadow-xl pointer-events-none">
                  <div className={`font-bold ${isParada ? 'text-red-400' : 'text-emerald-400'}`}>
                    {isParada ? 'Parada' : 'Produzindo'}{isParada && b.emAberto ? ' (em aberto)' : ''}
                  </div>
                  <div className="text-slate-300">
                    {formatarHora(b.inicio)} – {formatarHora(b.fim)} · <strong>{formatarDuracaoCurta(b.duracaoSeg)}</strong>
                  </div>
                  {isParada && (
                    <div className={b.motivo ? 'text-amber-300' : 'text-slate-400 italic'}>
                      {b.motivo || 'Ainda não classificada'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {futuroSeg > 0 && (
          <div
            className={`relative h-full rounded-r-lg ${blocos.length === 0 ? 'rounded-l-lg' : ''} bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.08),rgba(148,163,184,0.08)_6px,transparent_6px,transparent_12px)]`}
            style={{ width: `${(futuroSeg / totalSeg) * 100}%` }}
            onMouseEnter={() => setHoverKey('futuro')}
            onMouseLeave={() => setHoverKey((cur) => (cur === 'futuro' ? null : cur))}
          >
            {hoverKey === 'futuro' && (
              <div className="absolute bottom-full mb-1.5 right-0 z-20 whitespace-nowrap bg-slate-900 border border-slate-600 text-slate-400 text-[11px] rounded-md px-2.5 py-1.5 shadow-xl pointer-events-none italic">
                Ainda não aconteceu
              </div>
            )}
          </div>
        )}
      </div>

      {/* Totais de relance — sem precisar passar o mouse em cada bloquinho */}
      <div className="flex items-center gap-4 mt-1 text-[11px] font-mono">
        <span className="text-emerald-400 flex items-center gap-1">
          <span className="size-2 rounded-sm bg-emerald-500/90 shrink-0" />
          Produzindo: <strong>{formatarDuracaoCurta(totais.produzindoSeg)}</strong>
          {decorridoSeg > 0 && <span className="text-slate-500">({pctProduzindo.toFixed(0)}%)</span>}
        </span>
        <span className="text-red-400 flex items-center gap-1">
          <span className="size-2 rounded-sm bg-red-500/90 shrink-0" />
          Parado: <strong>{formatarDuracaoCurta(totais.paradoSeg)}</strong>
          {decorridoSeg > 0 && <span className="text-slate-500">({pctParado.toFixed(0)}%)</span>}
        </span>
      </div>
    </div>
  );
}
