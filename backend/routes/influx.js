const express = require('express');
const router = express.Router();
const { InfluxDBClient } = require('@influxdata/influxdb3-client');
const db = require('../db');

const hostUrl = process.env.INFLUX_URL || 'http://localhost:8181';
const formattedHost = hostUrl.startsWith('http') ? hostUrl : `http://${hostUrl}`;

const influxDB = new InfluxDBClient({
  host: formattedHost,
  token: process.env.INFLUX_TOKEN,
  database: process.env.INFLUX_BUCKET
});

// Lista de variáveis válidas antes vinha de um array fixo no código — agora
// vem do PostgreSQL (sensores_config.ativo = TRUE), para a tela de
// Configuração de Variáveis poder criar/desativar variáveis sem precisar
// alterar código. Fica em cache por alguns segundos (cada consulta a
// /metric ou /metrics chamava isso antes) e, se o PostgreSQL falhar, usamos
// a última lista boa conhecida em vez de derrubar as rotas de leitura do
// dashboard.
const FALLBACK_FIELDS = ["CTC", "CTP01", "CTP02", "CTP03", "CTP04", "CTP05", "CTP06", "CTQ", "CTV", "RUN_TIME_SEC", "TOTAL_COUNT", "GOOD_COUNT", "ALARM_COUNT"];
const VALID_FIELDS_CACHE_MS = 15000;
let validFieldsCache = { fields: FALLBACK_FIELDS, fetchedAt: 0 };

async function getValidFields() {
  const now = Date.now();
  if (now - validFieldsCache.fetchedAt < VALID_FIELDS_CACHE_MS) {
    return validFieldsCache.fields;
  }
  try {
    const result = await db.query('SELECT field_name FROM sensores_config WHERE ativo = TRUE ORDER BY field_name');
    const fields = result.rows.map((r) => r.field_name);
    // A consulta funcionou — o resultado é a verdade atual, mesmo que vazio
    // (usuário pode ter excluído todas as variáveis de propósito). O cache
    // só existe pra evitar bater no Postgres a cada /metric, não pra
    // "proteger" contra uma lista vazia legítima — isso escondia variáveis
    // já excluídas atrás de uma lista antiga pra sempre, até reiniciar o
    // backend. Só cai no fallback abaixo em erro DE VERDADE (catch).
    validFieldsCache = { fields, fetchedAt: now };
    return fields;
  } catch (err) {
    console.error('Erro ao buscar variáveis ativas no PostgreSQL, usando última lista conhecida:', err.message);
    return validFieldsCache.fields;
  }
}

const RANGE_TO_INTERVAL = {
  '1h': '1 hour',
  '8h': '8 hours',
  '24h': '24 hours',
  '7d': '7 days'
};

// Monta a cláusula WHERE de intervalo de tempo, usada tanto por /metric quanto
// por /metrics — antes essa lógica estava duplicada (copiada e colada) nas
// duas rotas.
//
// Lança um erro com mensagem amigável e statusCode 400 se startDate/endDate
// vierem inválidos, em vez de deixar o "new Date(...).toISOString()" estourar
// um erro não tratado fora do try/catch da rota.
function buildWhereClause({ range, startDate, endDate }) {
  if (startDate && endDate) {
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    if (Number.isNaN(startDateObj.getTime()) || Number.isNaN(endDateObj.getTime())) {
      const err = new Error('Data inicial ou final inválida.');
      err.statusCode = 400;
      throw err;
    }
    return `WHERE time >= '${startDateObj.toISOString()}' AND time <= '${endDateObj.toISOString()}'`;
  }

  const selectedInterval = RANGE_TO_INTERVAL[range] || RANGE_TO_INTERVAL['1h'];
  return `WHERE time >= NOW() - INTERVAL '${selectedInterval}'`;
}

// Extrai um número utilizável de uma linha de "tag_events": o valor pode vir
// em value_num (a grande maioria das nossas tags, todas 'real') ou em
// value_bool (tags booleanas, ex: TOP_STOP_BUTTON_INPUT) — nunca os dois.
// Convertido pra 0/1 no caso bool pra manter o mesmo formato numérico que o
// frontend (Recharts) já espera de quando líamos "Variaveis" direto.
function extractNumericValue(row) {
  if (row.value_num !== undefined && row.value_num !== null) return parseFloat(row.value_num);
  if (row.value_bool !== undefined && row.value_bool !== null) return row.value_bool ? 1 : 0;
  return null;
}

function formatBRDateTime(dateObj) {
  return dateObj.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

router.get('/fields', async (req, res) => {
  res.json(await getValidFields());
});

router.get('/metric', async (req, res) => {
  const { field, range, startDate, endDate } = req.query;
  const targetField = field || 'CTP01';
  const validFields = await getValidFields();

  if (!validFields.includes(targetField)) {
    return res.json([]);
  }

  let whereClause;
  try {
    whereClause = buildWhereClause({ range, startDate, endDate });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  // "tag_events" é o formato "longo" gravado pelo Wtecc Historian: uma linha
  // por leitura de tag (tag_name como tag indexada, valor em value_num ou
  // value_bool) — diferente do "Variaveis" antigo, que tinha uma coluna por
  // sensor. Cada tag filtrada por tag_name aqui já dá diretamente a série
  // temporal de UM campo, sem precisar de pivot.
  // SELECT * (não lista value_bool/value_num explicitamente) de propósito:
  // o InfluxDB 3 tem schema dinâmico por tabela — uma coluna só existe se já
  // foi escrita alguma vez. Hoje só gravamos tags 'real' (sem nenhuma
  // 'bool' ativa), então "value_bool" ainda nem existe no schema, e
  // referenciar a coluna direto no SELECT quebraria a query com "No field
  // named value_bool". extractNumericValue() já lida com a coluna ausente.
  const sqlQuery = `
    SELECT *
    FROM "tag_events"
    ${whereClause}
    AND tag_name = '${targetField}'
    ORDER BY time ASC
  `;

  try {
    const reader = await influxDB.query(sqlQuery);
    const data = [];

    for await (const row of reader) {
      const value = extractNumericValue(row);
      if (value !== null) {
        const dateObj = new Date(row.time);
        data.push({
          timestamp: dateObj.getTime(), // Retorna o valor em milissegundos para escala do Recharts
          time: formatBRDateTime(dateObj),
          value
        });
      }
    }

    res.json(data);
  } catch (err) {
    // Detalhe completo do erro só vai para o log do servidor — o cliente
    // recebe uma mensagem genérica, sem vazar detalhes internos (nome de
    // tabela, driver, etc.).
    console.error(`Erro ao consultar "${targetField}":`, err.message);
    res.status(400).json({ error: 'Erro ao consultar dados no InfluxDB. Tente novamente em instantes.' });
  }
});

// Consulta múltiplas variáveis de uma vez (usado pelos gráficos com mais de uma
// "pena"), numa única query ao InfluxDB em vez de uma requisição por variável.
//
// Como "tag_events" é formato longo, cada (tag_name, time) vem numa linha
// separada — leituras do MESMO ciclo de poll do CLP saem com timestamps a
// poucos microssegundos de diferença entre si (cada tag é gravada num
// `datetime.now()` próprio no coletor), não exatamente iguais. Por isso
// agrupamos por "balde" de 1s (arredondando o timestamp) pra reconstruir um
// único ponto por ciclo com todos os campos pedidos — do contrário, cada
// campo viraria uma série de pontos isolados, quebrando o gráfico
// multi-linha. 1s é seguro aqui porque o intervalo de poll real (5s) é bem
// maior que essa janela, então nunca mistura ciclos diferentes no mesmo balde.
const METRICS_BUCKET_MS = 1000;

router.get('/metrics', async (req, res) => {
  const { fields, range, startDate, endDate } = req.query;
  const requestedFields = (fields || '').split(',').map((f) => f.trim()).filter(Boolean);
  const allValidFields = await getValidFields();
  const validFields = requestedFields.filter((f) => allValidFields.includes(f));

  if (validFields.length === 0) {
    return res.json([]);
  }

  let whereClause;
  try {
    whereClause = buildWhereClause({ range, startDate, endDate });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  // SELECT * pelo mesmo motivo do /metric acima (schema dinâmico do InfluxDB 3).
  const tagNamesList = validFields.map((f) => `'${f}'`).join(', ');
  const sqlQuery = `
    SELECT *
    FROM "tag_events"
    ${whereClause}
    AND tag_name IN (${tagNamesList})
    ORDER BY time ASC
  `;

  try {
    const reader = await influxDB.query(sqlQuery);

    // Mapa ordenado por chave de balde (ms) -> ponto agregado
    const pointsByBucket = new Map();

    for await (const row of reader) {
      const value = extractNumericValue(row);
      if (value === null) continue;

      const rawMs = new Date(row.time).getTime();
      const bucketKey = Math.round(rawMs / METRICS_BUCKET_MS) * METRICS_BUCKET_MS;

      let point = pointsByBucket.get(bucketKey);
      if (!point) {
        const dateObj = new Date(bucketKey);
        point = { timestamp: bucketKey, time: formatBRDateTime(dateObj) };
        pointsByBucket.set(bucketKey, point);
      }
      point[row.tag_name] = value;
    }

    const data = Array.from(pointsByBucket.values()).sort((a, b) => a.timestamp - b.timestamp);
    res.json(data);
  } catch (err) {
    // Detalhe completo do erro só vai para o log do servidor — o cliente
    // recebe uma mensagem genérica, sem vazar detalhes internos.
    console.error(`Erro ao consultar múltiplos campos [${validFields.join(', ')}]:`, err.message);
    res.status(400).json({ error: 'Erro ao consultar dados no InfluxDB. Tente novamente em instantes.' });
  }
});

module.exports = router;
