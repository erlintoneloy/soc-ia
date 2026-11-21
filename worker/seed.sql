-- Semilla idempotente: se puede ejecutar varias veces sin romper por UNIQUE.
INSERT OR IGNORE INTO agentes_estado (id, nombre, estado) VALUES
('a1-uuid', 'Red', 'activo'),
('a2-uuid', 'Identidad', 'activo'),
('a3-uuid', 'Endpoint', 'activo');

INSERT OR IGNORE INTO sistema_salud (id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
VALUES (1, 100, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Usuarios de demo. Cambiar en un entorno real.
-- analista@soc-ia.demo / SocIA2026!
-- admin@soc-ia.demo    / AdminSocIA2026!
INSERT OR IGNORE INTO usuarios
(id, email, nombre, rol, password_hash, password_salt, password_iteraciones, activo, creado_en)
VALUES
('u-analista', 'analista@soc-ia.demo', 'Ana Analista', 'analista',
 '7fMYJi+DtcAihCwi3vJ1UZkd2z/RnIdpIFid5JnWA8g=', 'lYgTK2mfBcEteQ3xRL/HIA==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('u-admin', 'admin@soc-ia.demo', 'Admin SOC', 'admin',
 'vANkbreUyggNuw5ChGjBjHUOVfkZx9Q4VKyKDQwwyxQ=', 'IOI0tqYfRzd2iG7BUTFF1g==', 100000, 1,
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
