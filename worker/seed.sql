-- Insertar los 3 agentes
INSERT INTO agentes_estado (id, nombre, estado) VALUES 
('a1-uuid', 'Red', 'activo'),
('a2-uuid', 'Identidad', 'activo'),
('a3-uuid', 'Endpoint', 'activo');

-- Insertar un estado inicial de salud
INSERT INTO sistema_salud (salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en) 
VALUES (100, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
