-- Semilla idempotente: se puede ejecutar varias veces sin romper por UNIQUE.
INSERT OR IGNORE INTO agentes_estado (id, nombre, estado) VALUES
('a1-uuid', 'Red', 'activo'),
('a2-uuid', 'Identidad', 'activo'),
('a3-uuid', 'Endpoint', 'activo');

INSERT OR IGNORE INTO sistema_salud (id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
VALUES (1, 100, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
