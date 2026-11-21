import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENTE_POR_FUENTE,
  UMBRAL_AUTO_BLOQUEO,
  UMBRAL_FUERZA_BRUTA,
  calcularPrioridad,
  claveDedupe,
  evaluarEvento,
  superaUmbral,
} from '../../worker/src/engine.js';

test('reconoce las tres reglas del motor', () => {
  const escaneo = evaluarEvento({ fuente: 'red', tipo_evento: 'escaneo_puertos' });
  assert.equal(escaneo.agente, 'Red');
  assert.equal(escaneo.severidad, 'alta');

  const fuerza = evaluarEvento({ fuente: 'identidad', tipo_evento: 'login_fallido' });
  assert.equal(fuerza.agente, 'Identidad');
  assert.equal(fuerza.severidad, 'alta');

  const powershell = evaluarEvento({ fuente: 'endpoint', tipo_evento: 'powershell_encoded' });
  assert.equal(powershell.agente, 'Endpoint');
  assert.equal(powershell.severidad, 'critica');
});

test('ignora eventos fuera de las reglas', () => {
  assert.equal(evaluarEvento({ fuente: 'red', tipo_evento: 'request_normal' }), null);
  assert.equal(evaluarEvento({ fuente: 'identidad', tipo_evento: 'login_exitoso' }), null);
  assert.equal(evaluarEvento({ fuente: 'endpoint', tipo_evento: 'proceso_firmado' }), null);
});

test('calcula la prioridad por severidad y criticidad', () => {
  assert.equal(calcularPrioridad('critica', 'critica'), 'P1');
  assert.equal(calcularPrioridad('critica', 'alta'), 'P1');
  assert.equal(calcularPrioridad('alta', 'alta'), 'P2');
  assert.equal(calcularPrioridad('alta', 'media'), 'P2');
  assert.equal(calcularPrioridad('media', 'media'), 'P3');
  assert.equal(calcularPrioridad('baja', 'baja'), 'P3');
});

test('la ventana de fuerza bruta dispara en el sexto evento', () => {
  assert.equal(UMBRAL_FUERZA_BRUTA, 6);
  assert.equal(superaUmbral(0, 5, UMBRAL_FUERZA_BRUTA), false);
  assert.equal(superaUmbral(0, 6, UMBRAL_FUERZA_BRUTA), true);
  assert.equal(superaUmbral(5, 1, UMBRAL_FUERZA_BRUTA), true);
  assert.equal(superaUmbral(4, 1, UMBRAL_FUERZA_BRUTA), false);
});

test('la ventana de red dispara en el request 101', () => {
  assert.equal(UMBRAL_AUTO_BLOQUEO, 101);
  assert.equal(superaUmbral(0, 100, UMBRAL_AUTO_BLOQUEO), false);
  assert.equal(superaUmbral(0, 101, UMBRAL_AUTO_BLOQUEO), true);
  assert.equal(superaUmbral(100, 1, UMBRAL_AUTO_BLOQUEO), true);
});

test('la deduplicación distingue activos y actores', () => {
  const base = { fuente: 'endpoint', tipo_evento: 'powershell_encoded', host: 'WS-1', usuario: 'a' };
  assert.equal(claveDedupe(base), 'endpoint|powershell_encoded|WS-1|a');
  assert.notEqual(claveDedupe(base), claveDedupe({ ...base, host: 'WS-2' }));
  assert.notEqual(claveDedupe(base), claveDedupe({ ...base, usuario: 'b' }));
});

test('el mapa de fuentes cubre los tres agentes', () => {
  assert.deepEqual(Object.keys(AGENTE_POR_FUENTE).sort(), ['endpoint', 'identidad', 'red']);
});
