-- Wtecc Historian - schema inicial
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================
-- Cadastro de CLPs
-- ============================================================
CREATE TABLE IF NOT EXISTS plcs (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    brand           TEXT NOT NULL CHECK (brand IN ('rockwell', 'siemens', 'schneider', 'generic')),
    model           TEXT NOT NULL,          -- ex: compactlogix, micrologix, s7-1500, m221...
    driver          TEXT NOT NULL,          -- identifica qual driver o collector deve usar
    ip_address      TEXT NOT NULL,
    port            INTEGER,                -- opcional, depende do driver (ex: modbus 502)
    slot            INTEGER,                -- usado em rockwell (chassis slot)
    rack            INTEGER,                -- usado em siemens s7 (rack/slot)
    extra_config    JSONB DEFAULT '{}'::jsonb, -- parâmetros específicos do driver
    poll_interval_ms INTEGER NOT NULL DEFAULT 1000,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Cadastro de Tags
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
    id                  SERIAL PRIMARY KEY,
    plc_id              INTEGER NOT NULL REFERENCES plcs(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,          -- nome amigável, único por CLP
    address             TEXT NOT NULL,          -- endereço no CLP (ex: "Tag1", "DB1,DBD0", "40001")
    data_type           TEXT NOT NULL CHECK (data_type IN ('bool','int','dint','real','string')),
    description         TEXT,
    unit                TEXT,                   -- unidade de engenharia (ex: 'bar', 'C', 'rpm')

    -- Regras de logging (o "filtro" de histórico)
    logging_mode        TEXT NOT NULL DEFAULT 'cyclic'
                         CHECK (logging_mode IN ('cyclic', 'cos', 'deadband', 'conditional', 'compression')),
    deadband_value       NUMERIC,               -- usado quando logging_mode = 'deadband'
    trigger_tag_id       INTEGER REFERENCES tags(id) ON DELETE SET NULL, -- usado quando 'conditional'
    trigger_condition    TEXT,                  -- ex: '0->1', '1->0', 'any_change', '>', '<'
    trigger_value        NUMERIC,               -- valor de referência p/ condições tipo '>' '<'

    enabled              BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (plc_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_plc_id ON tags(plc_id);
CREATE INDEX IF NOT EXISTS idx_tags_trigger_tag_id ON tags(trigger_tag_id);

-- ============================================================
-- Série temporal de eventos (hypertable)
-- ============================================================
CREATE TABLE IF NOT EXISTS tag_events (
    time        TIMESTAMPTZ NOT NULL DEFAULT now(),
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    value_bool  BOOLEAN,
    value_num   DOUBLE PRECISION,
    value_str   TEXT,
    quality     TEXT NOT NULL DEFAULT 'good' -- 'good' | 'bad' | 'stale'
);

SELECT create_hypertable('tag_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_tag_events_tag_time ON tag_events (tag_id, time DESC);

-- Compressão nativa (dados com mais de 7 dias são comprimidos automaticamente)
ALTER TABLE tag_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tag_id'
);

SELECT add_compression_policy('tag_events', INTERVAL '7 days', if_not_exists => TRUE);

-- Retenção opcional (descomente se quiser apagar dados com mais de 2 anos)
-- SELECT add_retention_policy('tag_events', INTERVAL '730 days', if_not_exists => TRUE);

-- ============================================================
-- Última leitura conhecida por tag (usado pelo motor de regras
-- para saber o valor anterior e decidir se grava ou não)
-- ============================================================
CREATE TABLE IF NOT EXISTS tag_last_value (
    tag_id      INTEGER PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
    value_bool  BOOLEAN,
    value_num   DOUBLE PRECISION,
    value_str   TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Continuous aggregate de exemplo: média por hora de tags numéricas
CREATE MATERIALIZED VIEW IF NOT EXISTS tag_events_hourly
WITH (timescaledb.continuous) AS
SELECT
    tag_id,
    time_bucket('1 hour', time) AS bucket,
    avg(value_num) AS avg_value,
    min(value_num) AS min_value,
    max(value_num) AS max_value,
    count(*) AS sample_count
FROM tag_events
WHERE value_num IS NOT NULL
GROUP BY tag_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('tag_events_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE);

-- ============================================================
-- Autenticação — 3 papéis fixos com senha compartilhada (não é gestão
-- de usuário individual, foi decisão explícita do projeto). Senhas
-- definidas via scripts/set_role_password.py, nunca em texto puro aqui.
-- ============================================================
CREATE TABLE IF NOT EXISTS role_credentials (
    role            TEXT PRIMARY KEY CHECK (role IN ('viewer', 'operator', 'admin')),
    password_hash   TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
