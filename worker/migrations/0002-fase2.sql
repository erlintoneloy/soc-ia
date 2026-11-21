-- Migración de la Fase 2 sobre una base existente.
-- Ejecutar UNA sola vez (SQLite no soporta ADD COLUMN IF NOT EXISTS).
-- En instalaciones nuevas, `worker/schema.sql` ya incluye todo.

ALTER TABLE casos ADD COLUMN clave_dedupe TEXT;
ALTER TABLE casos ADD COLUMN ocurrencias INTEGER NOT NULL DEFAULT 1;
ALTER TABLE casos ADD COLUMN ultima_ocurrencia TEXT;
ALTER TABLE casos ADD COLUMN resumen_fuente TEXT NOT NULL DEFAULT 'ia';

UPDATE casos SET ultima_ocurrencia = creado_en WHERE ultima_ocurrencia IS NULL;

CREATE INDEX IF NOT EXISTS idx_casos_dedupe ON casos(clave_dedupe, ultima_ocurrencia);

CREATE TABLE IF NOT EXISTS rate_limit (
    clave TEXT PRIMARY KEY,
    ventana INTEGER NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    actualizado_en TEXT NOT NULL
);
