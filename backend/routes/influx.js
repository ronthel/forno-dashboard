const express = require('express');
const router = express.Router();
const { InfluxDBClient } = require('@influxdata/influxdb3-client');

const hostUrl = process.env.INFLUX_URL || 'http://localhost:8181';
const formattedHost = hostUrl.startsWith('http') ? hostUrl : `http://${hostUrl}`;

const influxDB = new InfluxDBClient({
  host: formattedHost,
  token: process.env.INFLUX_TOKEN,
  database: process.env.INFLUX_BUCKET
});

const VALID_FIELDS = ["CTC", "CTP01", "CTP02", "CTP03", "CTP04", "CTP05", "CTP06", "CTQ", "CTV", "teste","RUN_TIME_SEC", "TOTAL_COUNT", "GOOD_COUNT", "ALARM_COUNT"];

router.get('/fields', (req, res) => {
  res.json(VALID_FIELDS);
});

router.get('/metric', async (req, res) => {
  const { field, range, startDate, endDate } = req.query;
  const targetField = field || 'CTP01';

  if (!VALID_FIELDS.includes(targetField)) {
    return res.json([]);
  }

  let whereClause = "";

  if (startDate && endDate) {
    const startIso = new Date(startDate).toISOString();
    const endIso = new Date(endDate).toISOString();
    whereClause = `WHERE time >= '${startIso}' AND time <= '${endIso}'`;
  } else {
    const rangeMap = {
      '1h': "1 hour",
      '8h': "8 hours",
      '24h': "24 hours",
      '7d': "7 days"
    };
    const selectedInterval = rangeMap[range] || "1 hour";
    whereClause = `WHERE time >= NOW() - INTERVAL '${selectedInterval}'`;
  }

  const sqlQuery = `
    SELECT time, "${targetField}" 
    FROM "Variaveis" 
    ${whereClause} 
    ORDER BY time ASC
  `;

  try {
    const reader = await influxDB.query(sqlQuery);
    const data = [];

    for await (const row of reader) {
      if (row[targetField] !== undefined && row[targetField] !== null) {
        const dateObj = new Date(row.time);
        
        data.push({
          timestamp: dateObj.getTime(), // Retorna o valor em milissegundos para escala do Recharts
          time: dateObj.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          value: parseFloat(row[targetField])
        });
      }
    }

    res.json(data);
  } catch (err) {
    console.error(`Erro ao consultar "${targetField}":`, err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;