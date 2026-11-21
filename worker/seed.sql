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
