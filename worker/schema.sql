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

CREATE TABLE IF NOT EXISTS casos (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    severidad TEXT NOT NULL CHECK (severidad IN ('baja', 'media', 'alta', 'critica')),
    agente_responsable TEXT NOT NULL,
    resumen_ia TEXT,
    recomendacion_ia TEXT,
    clave_dedupe TEXT,
    ocurrencias INTEGER NOT NULL DEFAULT 1,
    ultima_ocurrencia TEXT,
    resumen_fuente TEXT NOT NULL DEFAULT 'ia',
    activo_id TEXT,
    tipo_evento TEXT,
    ip_origen TEXT,
    usuario_afectado TEXT,
    evidencia_json TEXT,
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
CREATE INDEX IF NOT EXISTS idx_casos_dedupe ON casos(clave_dedupe, ultima_ocurrencia);
CREATE INDEX IF NOT EXISTS idx_casos_activo ON casos(activo_id);
CREATE INDEX IF NOT EXISTS idx_activos_ip ON activos(ip);

-- Rate limit de la API (ventana fija por minuto)
CREATE TABLE IF NOT EXISTS rate_limit (
    clave TEXT PRIMARY KEY,
    ventana INTEGER NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    actualizado_en TEXT NOT NULL
);

-- Autenticación
CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('analista', 'admin')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iteraciones INTEGER NOT NULL DEFAULT 100000,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL,
    ultimo_acceso TEXT
);

CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    creado_en TEXT NOT NULL,
    expira_en TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira_en);

CREATE TABLE IF NOT EXISTS intentos_login (
    clave TEXT PRIMARY KEY,
    intentos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    actualizado_en TEXT NOT NULL
);