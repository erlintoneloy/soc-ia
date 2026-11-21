-- Semilla idempotente: se puede ejecutar varias veces sin romper por UNIQUE.

INSERT OR IGNORE INTO tenants (id, nombre, creado_en) VALUES
('clinica-valle-verde', 'Clínica Valle Verde', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('banco-litoral', 'Banco Litoral', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ===== Clínica Valle Verde =====
INSERT OR IGNORE INTO agentes_estado (id, tenant_id, nombre, estado) VALUES
('a1-uuid', 'clinica-valle-verde', 'Red', 'activo'),
('a2-uuid', 'clinica-valle-verde', 'Identidad', 'activo'),
('a3-uuid', 'clinica-valle-verde', 'Endpoint', 'activo');

INSERT OR IGNORE INTO sistema_salud (tenant_id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
VALUES ('clinica-valle-verde', 100, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Usuarios de demo. Las contraseñas no se versionan: se cargan en tests/.env.
INSERT OR IGNORE INTO usuarios
(id, tenant_id, email, nombre, rol, password_hash, password_salt, password_iteraciones, activo, creado_en)
VALUES
('u-analista', 'clinica-valle-verde', 'analista@soc-ia.demo', 'Ana Analista', 'analista',
 '2D0L5bpgxzSAzemDwwLIo9iKCYdpkVLiqjHy6NGYd7A=', 'dcm4o2VELYb/sLk9RwQpFg==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('u-admin', 'clinica-valle-verde', 'admin@soc-ia.demo', 'Admin SOC', 'admin',
 'GSY5UmffS0ZuJZ1KPFpL1Oa0liQ6m91EsRM4ZCP/UN0=', 'VavIahMRYlzsT+kvLI4R5w==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Inventario de la Clínica Valle Verde (organización ficticia).
INSERT OR IGNORE INTO activos
(id, tenant_id, hostname, ip, tipo, departamento, responsable, servicio, criticidad, sistema_operativo, activo, creado_en)
VALUES
('a-srv-his-01', 'clinica-valle-verde', 'SRV-HIS-01', '10.20.80.11', 'server', 'TI', 'admin.ti', 'Historia clínica (HIS)', 'critica', 'Windows Server 2019', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-lis-01', 'clinica-valle-verde', 'SRV-LIS-01', '10.20.80.12', 'server', 'Laboratorio', 'bioq.lab', 'Laboratorio (LIS)', 'critica', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-pacs-01', 'clinica-valle-verde', 'SRV-PACS-01', '10.20.80.13', 'server', 'Imágenes', 'tecnico.img', 'Imágenes (PACS)', 'critica', 'Windows Server 2019', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-ad-01', 'clinica-valle-verde', 'SRV-AD-01', '10.20.80.14', 'server', 'TI', 'admin.ti', 'Active Directory', 'critica', 'Windows Server 2022', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-erp-01', 'clinica-valle-verde', 'SRV-ERP-01', '10.20.80.15', 'server', 'Facturación', 'jefe.finanzas', 'ERP / Facturación', 'alta', 'Windows Server 2019', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-backup-01', 'clinica-valle-verde', 'SRV-BACKUP-01', '10.20.80.16', 'server', 'TI', 'admin.ti', 'Backups', 'alta', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-mail-01', 'clinica-valle-verde', 'SRV-MAIL-01', '10.20.80.17', 'server', 'TI', 'admin.ti', 'Correo', 'media', 'Debian 12', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-web-01', 'clinica-valle-verde', 'SRV-WEB-01', '10.20.80.18', 'server', 'TI', 'admin.ti', 'Portal de turnos', 'alta', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-fw-perimetro-01', 'clinica-valle-verde', 'FW-PERIMETRO-01', '10.20.80.1', 'gateway', 'TI', 'admin.ti', 'Perímetro', 'critica', 'FortiOS', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-vpn-gw-01', 'clinica-valle-verde', 'VPN-GW-01', '10.20.80.2', 'gateway', 'TI', 'admin.ti', 'VPN', 'alta', 'FortiOS', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-guardia-03', 'clinica-valle-verde', 'WS-GUARDIA-03', '10.20.10.13', 'workstation', 'Guardia', 'guardia.turno', 'Admisión de guardia', 'media', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-lab-07', 'clinica-valle-verde', 'WS-LAB-07', '10.20.20.7', 'workstation', 'Laboratorio', 'bioq.lab', 'Análisis de muestras', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-img-02', 'clinica-valle-verde', 'WS-IMG-02', '10.20.30.2', 'workstation', 'Imágenes', 'tecnico.img', 'Estación PACS', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-adm-11', 'clinica-valle-verde', 'WS-ADM-11', '10.20.40.11', 'workstation', 'Admisión', 'admision.01', 'Admisión', 'media', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-fac-05', 'clinica-valle-verde', 'WS-FAC-05', '10.20.50.5', 'workstation', 'Facturación', 'jefe.finanzas', 'Cliente ERP', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-far-02', 'clinica-valle-verde', 'WS-FAR-02', '10.20.60.2', 'workstation', 'Farmacia', 'farmacia.turno', 'Dispensación', 'alta', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-rrhh-04', 'clinica-valle-verde', 'WS-RRHH-04', '10.20.70.4', 'workstation', 'RRHH', 'rrhh.01', 'Legajos', 'media', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-lap-dir-01', 'clinica-valle-verde', 'LAP-DIR-01', '10.20.90.1', 'workstation', 'Dirección', 'direccion', 'Dirección', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Usuarios de negocio (ficticios) para dar contexto a los casos.
INSERT OR IGNORE INTO usuarios_negocio
(tenant_id, username, nombre, rol, area, activo_asignado, email, creado_en)
VALUES
('clinica-valle-verde', 'jefe.finanzas', 'Juan Pérez', 'Jefe de Finanzas', 'Facturación', 'WS-FAC-05', 'juan.perez@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'guardia.turno', 'Carla Ríos', 'Médica de Guardia', 'Guardia', 'WS-GUARDIA-03', 'carla.rios@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'bioq.lab', 'Martín Gómez', 'Bioquímico', 'Laboratorio', 'WS-LAB-07', 'martin.gomez@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'tecnico.img', 'Lucía Fernández', 'Técnica en Imágenes', 'Imágenes', 'WS-IMG-02', 'lucia.fernandez@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'admision.01', 'Sofía Álvarez', 'Agente de Admisión', 'Admisión', 'WS-ADM-11', 'sofia.alvarez@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'farmacia.turno', 'Diego Sosa', 'Farmacéutico', 'Farmacia', 'WS-FAR-02', 'diego.sosa@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'rrhh.01', 'Valentina López', 'Analista de RRHH', 'RRHH', 'WS-RRHH-04', 'valentina.lopez@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'admin.ti', 'Nicolás Herrera', 'Administrador de Sistemas', 'TI', 'SRV-AD-01', 'nicolas.herrera@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('clinica-valle-verde', 'direccion', 'Patricia Molina', 'Directora Médica', 'Dirección', 'LAP-DIR-01', 'patricia.molina@valleverde.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ===== Banco Litoral =====
INSERT OR IGNORE INTO agentes_estado (id, tenant_id, nombre, estado) VALUES
('b1-uuid', 'banco-litoral', 'Red', 'activo'),
('b2-uuid', 'banco-litoral', 'Identidad', 'activo'),
('b3-uuid', 'banco-litoral', 'Endpoint', 'activo');

INSERT OR IGNORE INTO sistema_salud (tenant_id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
VALUES ('banco-litoral', 100, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO usuarios
(id, tenant_id, email, nombre, rol, password_hash, password_salt, password_iteraciones, activo, creado_en)
VALUES
('u-banco-analista', 'banco-litoral', 'analista@banco-litoral.demo', 'Marina Duarte', 'analista',
 'FFD172Y2iyDTcOF0zV7+5HCeKJHAipnA5hippfdN81g=', 'uf0dvDEGpvpE/jLOhiNpLQ==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('u-banco-admin', 'banco-litoral', 'admin@banco-litoral.demo', 'Gustavo Rivas', 'admin',
 'H1RE8mM9qNxJQ3RPTCkGTn2kTXLdTzBAQZjnFb+burk=', 'g47cNe974mp6pVzCLav4sA==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO activos
(id, tenant_id, hostname, ip, tipo, departamento, responsable, servicio, criticidad, sistema_operativo, activo, creado_en)
VALUES
('a-banco-core-01', 'banco-litoral', 'SRV-CORE-01', '10.30.80.11', 'server', 'TI', 'admin.banco', 'Core bancario', 'critica', 'RHEL 9', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-banco-home-01', 'banco-litoral', 'SRV-HOME-01', '10.30.80.12', 'server', 'TI', 'admin.banco', 'Home banking', 'critica', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-banco-fw-01', 'banco-litoral', 'FW-BANCO-01', '10.30.80.1', 'gateway', 'TI', 'admin.banco', 'Perímetro', 'critica', 'FortiOS', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-banco-caja-05', 'banco-litoral', 'WS-CAJA-05', '10.30.20.5', 'workstation', 'Sucursal Centro', 'cajero.01', 'Caja', 'alta', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO usuarios_negocio
(tenant_id, username, nombre, rol, area, activo_asignado, email, creado_en)
VALUES
('banco-litoral', 'jefe.tesoreria', 'Laura Méndez', 'Jefa de Tesorería', 'Tesorería', 'SRV-HOME-01', 'laura.mendez@bancolitoral.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('banco-litoral', 'cajero.01', 'Pablo Ruiz', 'Cajero', 'Sucursal Centro', 'WS-CAJA-05', 'pablo.ruiz@bancolitoral.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('banco-litoral', 'admin.banco', 'Sergio Vidal', 'Administrador de Sistemas', 'TI', 'SRV-CORE-01', 'sergio.vidal@bancolitoral.demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
