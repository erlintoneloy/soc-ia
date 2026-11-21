-- Migración de la Fase 3: inventario de activos y contexto en los casos.
-- Ejecutar UNA sola vez sobre bases existentes.

CREATE TABLE IF NOT EXISTS activos (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    ip TEXT NOT NULL,
    tipo TEXT,
    departamento TEXT,
    responsable TEXT,
    servicio TEXT,
    criticidad TEXT NOT NULL CHECK (criticidad IN ('baja', 'media', 'alta', 'critica')),
    sistema_operativo TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL
);

ALTER TABLE casos ADD COLUMN activo_id TEXT;
ALTER TABLE casos ADD COLUMN tipo_evento TEXT;
ALTER TABLE casos ADD COLUMN ip_origen TEXT;
ALTER TABLE casos ADD COLUMN usuario_afectado TEXT;
ALTER TABLE casos ADD COLUMN evidencia_json TEXT;

CREATE INDEX IF NOT EXISTS idx_casos_activo ON casos(activo_id);
CREATE INDEX IF NOT EXISTS idx_activos_ip ON activos(ip);
