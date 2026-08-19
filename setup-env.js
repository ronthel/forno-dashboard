// Reconfigura os .env do projeto para rodar em Docker Compose.
// Roda uma vez, direto na máquina Linux, dentro da pasta raiz do projeto.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function parseEnv(text) {
  const map = new Map();
  const order = [];
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      map.set(m[1], m[2]);
      order.push(m[1]);
    }
  });
  return { map, order };
}

function writeEnv(filePath, map, order) {
  const lines = order.map((k) => `${k}=${map.get(k)}`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

const root = process.cwd();
const backendEnvPath = path.join(root, 'backend', '.env');
const frontendEnvPath = path.join(root, 'frontend', '.env');
const plcEnvPath = path.join(root, 'plc-service', '.env');
const rootEnvPath = path.join(root, '.env');

// --- backend/.env ---
const backendText = fs.readFileSync(backendEnvPath, 'utf8');
const { map: backend, order: backendOrder } = parseEnv(backendText);

const pgUser = 'forno_app';
const pgPassword = crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
const pgDb = 'forno_db';

backend.set('POSTGRES_HOST', 'postgres');
backend.set('POSTGRES_USER', pgUser);
backend.set('POSTGRES_PASSWORD', pgPassword);
backend.set('POSTGRES_PORT', '5432');
if (!backend.has('POSTGRES_DB')) backendOrder.push('POSTGRES_DB');
backend.set('POSTGRES_DB', pgDb);
// remove a chave antiga que o código nunca leu (POSTGRES_DATABASE)
backend.delete('POSTGRES_DATABASE');
const backendOrderClean = backendOrder.filter((k) => k !== 'POSTGRES_DATABASE');

backend.set('INFLUX_URL', 'http://influxdb:8181');
backend.set('INFLUX_BUCKET', 'forno');
backend.set('INFLUX_TOKEN', ''); // preenchido depois de criar o token admin do InfluxDB novo
if (!backend.has('INFLUX_ORG')) backendOrderClean.push('INFLUX_ORG');
// INFLUX_ORG não é usado pelo código (InfluxDB 3 não tem esse conceito) — mantém só por compatibilidade do .env.example

writeEnv(backendEnvPath, backend, backendOrderClean);

// --- .env raiz (usado pelo docker-compose para inicializar o Postgres) ---
fs.writeFileSync(
  rootEnvPath,
  `POSTGRES_USER=${pgUser}\nPOSTGRES_PASSWORD=${pgPassword}\nPOSTGRES_DB=${pgDb}\n`
);

// --- frontend/.env ---
if (fs.existsSync(frontendEnvPath)) {
  const frontendText = fs.readFileSync(frontendEnvPath, 'utf8');
  const { map: frontend, order: frontendOrder } = parseEnv(frontendText);
  frontend.set('VITE_API_URL', 'http://192.168.15.103:5000');
  writeEnv(frontendEnvPath, frontend, frontendOrder);
}

// --- plc-service/.env (não existia ainda) ---
fs.writeFileSync(
  plcEnvPath,
  `INFLUX_URL=http://influxdb:8181\nINFLUX_TOKEN=\nINFLUX_BUCKET=forno\n`
);

console.log('OK: .env atualizados (backend, frontend, plc-service, raiz).');
console.log('Pendente: preencher INFLUX_TOKEN em backend/.env e plc-service/.env após criar o token admin do InfluxDB.');
