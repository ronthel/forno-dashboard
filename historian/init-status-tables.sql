-- Tabelas de status (heartbeat) que o collector.py referencia (StatusBuffer/
-- TagStatusBuffer, ver main.py) mas que não vieram no init.sql original —
-- provavelmente uma migração que ficou de fora do que foi compactado.
-- Colunas inferidas diretamente dos INSERT ... ON CONFLICT do main.py.

CREATE TABLE IF NOT EXISTS plc_status (
    plc_id      INTEGER PRIMARY KEY REFERENCES plcs(id) ON DELETE CASCADE,
    connected   BOOLEAN NOT NULL,
    last_error  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag_status (
    tag_id      INTEGER PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
    ok          BOOLEAN NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
