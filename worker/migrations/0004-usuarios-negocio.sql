-- Migración de la Fase 3.5: directorio de usuarios de negocio.
-- Ejecutar UNA sola vez sobre bases existentes.

CREATE TABLE IF NOT EXISTS usuarios_negocio (
    username TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    rol TEXT,
    area TEXT,
    activo_asignado TEXT,
    email TEXT,
    creado_en TEXT NOT NULL
);
