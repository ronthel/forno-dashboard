-- Cadastra nosso CLP real e as tags já monitoradas pelo plc-service
-- (mesma lista de ~/projects/forno-dashboard/plc-service/monitored_tags.json),
-- só pra teste de integração do coletor do Wtecc Historian.

INSERT INTO plcs (name, brand, model, driver, ip_address, slot, poll_interval_ms, enabled)
VALUES ('Forno01', 'rockwell', 'CompactLogix (Logix Echo)', 'rockwell_logix', '192.168.15.108', 0, 5000, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO tags (plc_id, name, address, data_type, description, logging_mode, enabled)
SELECT p.id, t.name, t.name, 'real', 'Tag de teste — migrada do plc-service', 'cyclic', true
FROM plcs p
CROSS JOIN (VALUES
    ('CTC'), ('CTP01'), ('CTP02'), ('CTP03'), ('CTP04'),
    ('CTP05'), ('CTP06'), ('CTP07'), ('CTQ'), ('CTV')
) AS t(name)
WHERE p.name = 'Forno01'
ON CONFLICT (plc_id, name) DO NOTHING;
