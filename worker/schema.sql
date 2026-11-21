PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    fuente TEXT NOT NULL CHECK (fuente IN ('red', 'identidad', 'endpoint')),
    tipo_evento TEXT NOT NULL,
    ip_origen TEXT,
    destino_ip TEXT,
    host TEXT,
    usuario TEXT,
    activo_id TEXT,
    resultado TEXT,
    payload_json TEXT NOT NULL,
    procesado BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS casos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS activos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    ip TEXT NOT NULL,
    tipo TEXT,
    departamento TEXT,
    responsable TEXT,
    servicio TEXT,
    criticidad TEXT NOT NULL CHECK (criticidad IN ('baja', 'media', 'alta', 'critica')),
    sistema_operativo TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL,
    UNIQUE (tenant_id, hostname)
);

CREATE TABLE IF NOT EXISTS agentes_estado (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    logs_procesados INTEGER DEFAULT 0,
    logs_bloqueados INTEGER DEFAULT 0,
    casos_escalados INTEGER DEFAULT 0,
    estado TEXT CHECK (estado IN ('activo', 'alerta', 'offline')),
    UNIQUE (tenant_id, nombre)
);

CREATE TABLE IF NOT EXISTS sistema_salud (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL UNIQUE,
    salud_porcentaje INTEGER NOT NULL DEFAULT 100,
    amenazas_activas INTEGER DEFAULT 0,
    logs_por_segundo INTEGER DEFAULT 0,
    actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios_negocio (
    tenant_id TEXT NOT NULL,
    username TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT,
    area TEXT,
    activo_asignado TEXT,
    email TEXT,
    creado_en TEXT NOT NULL,
    PRIMARY KEY (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'clinica-valle-verde',
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

CREATE TABLE IF NOT EXISTS intentos_login (
    clave TEXT PRIMARY KEY,
    intentos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit (
    clave TEXT PRIMARY KEY,
    ventana INTEGER NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    actualizado_en TEXT NOT NULL
);

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

-- Índices generales
CREATE INDEX IF NOT EXISTS idx_logs_fuente ON logs(fuente);
CREATE INDEX IF NOT EXISTS idx_logs_ip ON logs(ip_origen);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_tenant ON logs(tenant_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_casos_estado ON casos(estado);
CREATE INDEX IF NOT EXISTS idx_casos_dedupe ON casos(clave_dedupe, ultima_ocurrencia);
CREATE INDEX IF NOT EXISTS idx_casos_activo ON casos(activo_id);
CREATE INDEX IF NOT EXISTS idx_casos_tenant ON casos(tenant_id, estado);

CREATE INDEX IF NOT EXISTS idx_activos_ip ON activos(ip);
CREATE INDEX IF NOT EXISTS idx_activos_tenant ON activos(tenant_id);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira_en);

CREATE INDEX IF NOT EXISTS idx_auditoria_tenant ON auditoria(tenant_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_tokens_tenant ON tokens_simulacion(tenant_id);
