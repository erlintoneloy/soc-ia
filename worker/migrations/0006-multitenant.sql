-- Migración de la Fase 6: multi-tenant.
-- Ejecutar UNA sola vez sobre bases existentes. Los datos previos quedan
-- asignados a 'clinica-valle-verde'.

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    creado_en TEXT NOT NULL
);

INSERT OR IGNORE INTO tenants (id, nombre, creado_en) VALUES
('clinica-valle-verde', 'Clínica Valle Verde', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('banco-litoral', 'Banco Litoral', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

ALTER TABLE usuarios ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'clinica-valle-verde';
ALTER TABLE casos ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'clinica-valle-verde';
ALTER TABLE logs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'clinica-valle-verde';

-- activos: la unicidad de hostname pasa a ser por tenant.
CREATE TABLE activos_tenant (
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

INSERT INTO activos_tenant
    (id, tenant_id, hostname, ip, tipo, departamento, responsable, servicio, criticidad, sistema_operativo, activo, creado_en)
SELECT id, 'clinica-valle-verde', hostname, ip, tipo, departamento, responsable, servicio, criticidad, sistema_operativo, activo, creado_en
  FROM activos;

DROP TABLE activos;
ALTER TABLE activos_tenant RENAME TO activos;

-- agentes_estado: un juego de agentes por tenant.
CREATE TABLE agentes_tenant (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    logs_procesados INTEGER DEFAULT 0,
    logs_bloqueados INTEGER DEFAULT 0,
    casos_escalados INTEGER DEFAULT 0,
    estado TEXT CHECK (estado IN ('activo', 'alerta', 'offline')),
    UNIQUE (tenant_id, nombre)
);

INSERT INTO agentes_tenant (id, tenant_id, nombre, logs_procesados, logs_bloqueados, casos_escalados, estado)
SELECT id, 'clinica-valle-verde', nombre, logs_procesados, logs_bloqueados, casos_escalados, estado
  FROM agentes_estado;

DROP TABLE agentes_estado;
ALTER TABLE agentes_tenant RENAME TO agentes_estado;

-- usuarios_negocio: clave compuesta por tenant y username.
CREATE TABLE usuarios_negocio_tenant (
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

INSERT INTO usuarios_negocio_tenant (tenant_id, username, nombre, rol, area, activo_asignado, email, creado_en)
SELECT 'clinica-valle-verde', username, nombre, rol, area, activo_asignado, email, creado_en
  FROM usuarios_negocio;

DROP TABLE usuarios_negocio;
ALTER TABLE usuarios_negocio_tenant RENAME TO usuarios_negocio;

-- sistema_salud: una fila por tenant.
CREATE TABLE sistema_salud_tenant (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL UNIQUE,
    salud_porcentaje INTEGER NOT NULL DEFAULT 100,
    amenazas_activas INTEGER DEFAULT 0,
    logs_por_segundo INTEGER DEFAULT 0,
    actualizado_en TEXT NOT NULL
);

INSERT INTO sistema_salud_tenant (id, tenant_id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
SELECT id, 'clinica-valle-verde', salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en
  FROM sistema_salud;

DROP TABLE sistema_salud;
ALTER TABLE sistema_salud_tenant RENAME TO sistema_salud;

CREATE INDEX IF NOT EXISTS idx_logs_tenant ON logs(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_casos_tenant ON casos(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_activos_ip ON activos(ip);
CREATE INDEX IF NOT EXISTS idx_activos_tenant ON activos(tenant_id);
