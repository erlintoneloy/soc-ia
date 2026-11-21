-- Migración de la Fase 4: logs con contexto y resultado para la consola.
-- Ejecutar UNA sola vez sobre bases existentes.

ALTER TABLE logs ADD COLUMN destino_ip TEXT;
ALTER TABLE logs ADD COLUMN host TEXT;
ALTER TABLE logs ADD COLUMN activo_id TEXT;
ALTER TABLE logs ADD COLUMN resultado TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
