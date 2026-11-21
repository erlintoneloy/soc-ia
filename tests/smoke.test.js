'use strict';

/**
 * Smoke test end-to-end de SOC-IA.
 *
 * Requiere el Worker corriendo en local:
 *   cd worker && npx wrangler dev
 *
 * Ejecutar desde la raíz del repositorio:
 *   npm run test:smoke
 *
 * Cada corrida usa un identificador único para no colisionar con casos previos.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const BASE_URL = (process.env.SOC_IA_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const RUN_ID = randomUUID().slice(0, 8);
const REQUEST_TIMEOUT_MS = 10000;
const AI_TIMEOUT_MS = 30000;

let caseId = null;

async function api(path, { timeout = REQUEST_TIMEOUT_MS, ...options } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeout),
  });

  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    assert.fail(`Respuesta no JSON en ${path} (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }

  return { status: response.status, json };
}

async function activeCaseIds() {
  const { json } = await api('/api/dashboard');
  assert.equal(json.ok, true, 'El dashboard respondió ok:false');
  return new Set(json.data.casos_activos.map((caso) => caso.id));
}

describe('SOC-IA smoke test', () => {
  before(async () => {
    let health;

    try {
      health = await api('/api/health');
    } catch (error) {
      throw new Error(
        `No se pudo conectar al Worker en ${BASE_URL}.\n` +
          'Levanta el Worker con "npx wrangler dev" dentro de worker/ antes de correr el smoke test.\n' +
          `Causa: ${error.message}`
      );
    }

    assert.equal(health.status, 200, 'GET /api/health debe responder HTTP 200');
    assert.equal(health.json.ok, true, 'GET /api/health debe responder ok:true');
  });

  after(async () => {
    if (!caseId) return;

    try {
      await api(`/api/cases/${caseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'falso_positivo' }),
      });
    } catch {
      // La limpieza es best-effort: no debe ocultar el resultado de las pruebas.
    }
  });

  it('expone un health check con D1 conectada', async () => {
    const { json } = await api('/api/health');

    assert.equal(json.data.database, 'D1 Conectada', 'D1 no está conectada: revisa el binding DB y la migración local');
    assert.match(json.data.status, /operativo/i);
  });

  it('descarta un log de ruido sin escalarlo al humano', async () => {
    const log = {
      fuente: 'identidad',
      tipo_evento: 'login_exitoso',
      usuario: `smoke_${RUN_ID}`,
      ip: '10.255.255.1',
    };

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({ logs: [log] }),
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(json.data, { procesados: 1, escalados: 0, descartados: 1 });
  });

  it('escala un ataque de fuerza bruta y crea el caso', { timeout: AI_TIMEOUT_MS + 15000 }, async () => {
    const idsBefore = await activeCaseIds();

    const log = {
      fuente: 'identidad',
      tipo_evento: 'login_fallido',
      usuario: `smoke_${RUN_ID}`,
      ip: '10.255.255.2',
      intentos: 15,
    };

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      timeout: AI_TIMEOUT_MS,
      body: JSON.stringify({ logs: [log] }),
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.procesados, 1);
    assert.equal(json.data.escalados, 1, 'Un login_fallido con intentos > 5 debe escalarse');

    const { json: dashboard } = await api('/api/dashboard');
    const nuevoCaso = dashboard.data.casos_activos.find((caso) => !idsBefore.has(caso.id));

    assert.ok(nuevoCaso, 'El caso escalado no aparece en /api/dashboard');
    assert.equal(nuevoCaso.agente_responsable, 'Agente Identidad');
    assert.ok(nuevoCaso.resumen_ia, 'El caso debe traer resumen_ia (real o fallback)');

    caseId = nuevoCaso.id;
  });

  it('devuelve un dashboard consistente', async () => {
    const { status, json } = await api('/api/dashboard');
    const { salud_sistema, agentes, casos_activos } = json.data;

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(typeof salud_sistema, 'number');
    assert.ok(salud_sistema >= 0 && salud_sistema <= 100, `Salud fuera de rango: ${salud_sistema}`);
    assert.ok(Array.isArray(casos_activos), 'casos_activos debe ser un array');
    assert.ok(Array.isArray(agentes), 'agentes debe ser un array');
    assert.ok(
      agentes.length > 0,
      'No hay agentes registrados: aplica worker/seed.sql a la D1 local'
    );

    for (const agente of agentes) {
      assert.equal(typeof agente.nombre, 'string');
      assert.equal(typeof agente.logs_procesados, 'number');
    }
  });

  it('permite al analista resolver el caso y lo saca de la cola', { timeout: REQUEST_TIMEOUT_MS * 2 }, async () => {
    assert.ok(caseId, 'No hay caso creado por la prueba anterior');

    const { status, json } = await api(`/api/cases/${caseId}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'contenido' }),
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);

    const idsAfter = await activeCaseIds();
    assert.equal(idsAfter.has(caseId), false, 'El caso resuelto no debe seguir en casos_activos');
  });
});
