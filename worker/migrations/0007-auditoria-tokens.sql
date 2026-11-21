-- Migración de la Fase 6.5/7: auditoría y tokens de simulación.
-- Ejecutar UNA sola vez sobre bases existentes.

CREATE TABLE IF NOT EXISTS auditoria (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    usuario_id TEXT,
    usuario_email TEXT,
    rol TEXT,
    accion TEXT NOT NULL,
    detalle_json TEXT,
    ip TEXT,
    creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens_simulacion (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_por TEXT,
    creado_en TEXT NOT NULL,
    ultimo_uso TEXT
);

CREATE INDEX IF NOT EXISTS idx_auditoria_tenant ON auditoria(tenant_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_tokens_tenant ON tokens_simulacion(tenant_id);
