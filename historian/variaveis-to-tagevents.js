// Converte o histórico da tabela "Variaveis" (formato largo, nosso) para
// "tag_events" (formato longo, do Wtecc Historian) — preserva o histórico
// na virada de fonte de dados.
// Uso: node variaveis-to-tagevents.js <entrada.json> <saida.lp>
'use strict';
const fs = require('fs');

const [, , inPath, outPath] = process.argv;

const TAG_ID = {
  CTC: 1, CTP01: 2, CTP02: 3, CTP03: 4, CTP04: 5,
  CTP05: 6, CTP06: 7, CTP07: 8, CTQ: 9, CTV: 10,
};
const PLC_ID = 1;

let rawText = fs.readFileSync(inPath, 'utf8');
rawText = rawText.replace(/:(-?\d{16,})(?=[,}])/g, ':"$1"');
const rows = JSON.parse(rawText);

function isoToNanos(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!m) throw new Error('timestamp inesperado: ' + iso);
  const [, y, mo, d, h, mi, s, frac = ''] = m;
  const msDate = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const secBigInt = BigInt(msDate / 1000);
  const fracPadded = (frac + '000000000').slice(0, 9);
  return secBigInt * 1000000000n + BigInt(fracPadded);
}

let lines = 0;
const out = fs.createWriteStream(outPath);

for (const row of rows) {
  if (!row.time) continue;
  const ts = isoToNanos(row.time);
  for (const [field, tagId] of Object.entries(TAG_ID)) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    out.write(
      `tag_events,tag_id=${tagId},plc_id=${PLC_ID},tag_name=${field} value_num=${value},quality="good" ${ts.toString()}\n`
    );
    lines++;
  }
}

out.end(() => {
  console.log(`OK: ${lines} linhas escritas em ${outPath}`);
});
