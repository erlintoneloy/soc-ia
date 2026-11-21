-- Semilla idempotente: se puede ejecutar varias veces sin romper por UNIQUE.
INSERT OR IGNORE INTO agentes_estado (id, nombre, estado) VALUES
('a1-uuid', 'Red', 'activo'),
('a2-uuid', 'Identidad', 'activo'),
('a3-uuid', 'Endpoint', 'activo');

INSERT OR IGNORE INTO sistema_salud (id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
VALUES (1, 100, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Usuarios de demo. Las contraseñas no se versionan: se comparten fuera del
-- repositorio y se cargan en `.env` para tests y simulador.
INSERT OR IGNORE INTO usuarios
(id, email, nombre, rol, password_hash, password_salt, password_iteraciones, activo, creado_en)
VALUES
('u-analista', 'analista@soc-ia.demo', 'Ana Analista', 'analista',
 '2D0L5bpgxzSAzemDwwLIo9iKCYdpkVLiqjHy6NGYd7A=', 'dcm4o2VELYb/sLk9RwQpFg==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('u-admin', 'admin@soc-ia.demo', 'Admin SOC', 'admin',
 'GSY5UmffS0ZuJZ1KPFpL1Oa0liQ6m91EsRM4ZCP/UN0=', 'VavIahMRYlzsT+kvLI4R5w==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Inventario de la Clínica Valle Verde (organización ficticia).
INSERT OR IGNORE INTO activos
(id, hostname, ip, tipo, departamento, responsable, servicio, criticidad, sistema_operativo, activo, creado_en)
VALUES
('a-srv-his-01', 'SRV-HIS-01', '10.20.80.11', 'server', 'TI', 'admin.ti', 'Historia clínica (HIS)', 'critica', 'Windows Server 2019', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-lis-01', 'SRV-LIS-01', '10.20.80.12', 'server', 'Laboratorio', 'bioq.lab', 'Laboratorio (LIS)', 'critica', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-pacs-01', 'SRV-PACS-01', '10.20.80.13', 'server', 'Imágenes', 'tecnico.img', 'Imágenes (PACS)', 'critica', 'Windows Server 2019', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-ad-01', 'SRV-AD-01', '10.20.80.14', 'server', 'TI', 'admin.ti', 'Active Directory', 'critica', 'Windows Server 2022', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-erp-01', 'SRV-ERP-01', '10.20.80.15', 'server', 'Facturación', 'jefe.finanzas', 'ERP / Facturación', 'alta', 'Windows Server 2019', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-backup-01', 'SRV-BACKUP-01', '10.20.80.16', 'server', 'TI', 'admin.ti', 'Backups', 'alta', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-mail-01', 'SRV-MAIL-01', '10.20.80.17', 'server', 'TI', 'admin.ti', 'Correo', 'media', 'Debian 12', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-srv-web-01', 'SRV-WEB-01', '10.20.80.18', 'server', 'TI', 'admin.ti', 'Portal de turnos', 'alta', 'Ubuntu Server 22.04', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-fw-perimetro-01', 'FW-PERIMETRO-01', '10.20.80.1', 'gateway', 'TI', 'admin.ti', 'Perímetro', 'critica', 'FortiOS', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-vpn-gw-01', 'VPN-GW-01', '10.20.80.2', 'gateway', 'TI', 'admin.ti', 'VPN', 'alta', 'FortiOS', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-guardia-03', 'WS-GUARDIA-03', '10.20.10.13', 'workstation', 'Guardia', 'guardia.turno', 'Admisión de guardia', 'media', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-lab-07', 'WS-LAB-07', '10.20.20.7', 'workstation', 'Laboratorio', 'bioq.lab', 'Análisis de muestras', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-img-02', 'WS-IMG-02', '10.20.30.2', 'workstation', 'Imágenes', 'tecnico.img', 'Estación PACS', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-adm-11', 'WS-ADM-11', '10.20.40.11', 'workstation', 'Admisión', 'admision.01', 'Admisión', 'media', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-fac-05', 'WS-FAC-05', '10.20.50.5', 'workstation', 'Facturación', 'jefe.finanzas', 'Cliente ERP', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-far-02', 'WS-FAR-02', '10.20.60.2', 'workstation', 'Farmacia', 'farmacia.turno', 'Dispensación', 'alta', 'Windows 10', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-ws-rrhh-04', 'WS-RRHH-04', '10.20.70.4', 'workstation', 'RRHH', 'rrhh.01', 'Legajos', 'media', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('a-lap-dir-01', 'LAP-DIR-01', '10.20.90.1', 'workstation', 'Dirección', 'direccion', 'Dirección', 'alta', 'Windows 11', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
