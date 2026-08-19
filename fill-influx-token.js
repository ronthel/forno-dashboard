// Preenche INFLUX_TOKEN em backend/.env e plc-service/.env.
// Uso: node fill-influx-token.js <token>   (lido de stdin se preferir: echo "$TOKEN" | node fill-influx-token.js)
'use strict';
const fs = require('fs');
const path = require('path');

function setKey(filePath, key, value) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0 || l === '');
  let found = false;
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  fs.writeFileSync(filePath, out.filter((l) => l !== '').join('\n') + '\n');
}

const token = process.argv[2] || fs.readFileSync(0, 'utf8').trim();
if (!token) {
  console.error('Token vazio — aborta.');
  process.exit(1);
}

const root = process.cwd();
setKey(path.join(root, 'backend', '.env'), 'INFLUX_TOKEN', token);
setKey(path.join(root, 'plc-service', '.env'), 'INFLUX_TOKEN', token);
console.log('OK: INFLUX_TOKEN gravado em backend/.env e plc-service/.env.');
