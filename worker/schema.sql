PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    fuente TEXT NOT NULL CHECK (fuente IN ('red', 'identidad', 'endpoint')),
    tipo_evento TEXT NOT NULL,
    ip_origen TEXT,
    usuario TEXT,
    payload_json TEXT NOT NULL,
    procesado BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS casos (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    severidad TEXT NOT NULL CHECK (severidad IN ('baja', 'media', 'alta', 'critica')),
    agente_responsable TEXT NOT NULL,
    resumen_ia TEXT,
    recomendacion_ia TEXT,
    estado TEXT NOT NULL CHECK (estado IN ('escalado', 'en_triaje', 'contenido', 'falso_positivo')),
    creado_en TEXT NOT NULL,
    resuelto_en TEXT
);

CREATE TABLE IF NOT EXISTS agentes_estado (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    logs_procesados INTEGER DEFAULT 0,
    logs_bloqueados INTEGER DEFAULT 0,
    casos_escalados INTEGER DEFAULT 0,
    estado TEXT CHECK (estado IN ('activo', 'alerta', 'offline'))
);

CREATE TABLE IF NOT EXISTS sistema_salud (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salud_porcentaje INTEGER NOT NULL DEFAULT 100,
    amenazas_activas INTEGER DEFAULT 0,
    logs_por_segundo INTEGER DEFAULT 0,
    actualizado_en TEXT NOT NULL
);

-- Índices para rendimiento de los agentes
CREATE INDEX IF NOT EXISTS idx_logs_fuente ON logs(fuente);
CREATE INDEX IF NOT EXISTS idx_logs_ip ON logs(ip_origen);
CREATE INDEX IF NOT EXISTS idx_casos_estado ON casos(estado);