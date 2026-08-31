import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

// Ícone pequeno de "i" que mostra uma explicação (a fórmula + os números
// reais que chegaram naquele valor) ao passar o mouse — usado nos campos
// calculados da tela de OEE, pra quem está olhando entender de onde veio o
// número sem precisar perguntar.
//
// O balão é renderizado num portal direto no <body> (não como filho normal
// aqui no lugar) de propósito: o layout da tela (App.jsx) tem contêineres
// com `overflow-hidden` pro scroll de cada tela funcionar direito, e isso
// CORTA qualquer coisa posicionada normalmente que tente "vazar" pra fora
// deles — foi exatamente o que cortava o balão perto da barra lateral. Fora
// desses contêineres (direto no body, com position fixed calculada pela
// posição real do ícone na tela), ele nunca é cortado, não importa onde o
// campo esteja.
export default function InfoTooltip({ text, className = '' }) {
  const [rect, setRect] = useState(null);
  const iconRef = useRef(null);

  const show = () => iconRef.current && setRect(iconRef.current.getBoundingClientRect());
  const hide = () => setRect(null);

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <Info
        ref={iconRef}
        size={12}
        className="text-slate-500 hover:text-slate-300 cursor-help shrink-0"
        onMouseEnter={show}
        onMouseLeave={hide}
      />
      {rect && createPortal(<TooltipBubble rect={rect} text={text} />, document.body)}
    </span>
  );
}

function TooltipBubble({ rect, text }) {
  const width = Math.min(256, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));

  return (
    <div
      className="fixed z-[9999] pointer-events-none rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5
                 text-[10px] leading-snug font-normal normal-case text-slate-200 shadow-xl whitespace-pre-line"
      style={{ width, left, top: rect.top - 6, transform: 'translateY(-100%)' }}
    >
      {text}
    </div>
  );
}
