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

/** Ids de los casos creados por esta corrida, para limpiarlos al final. */
const casosCreados = [];
let casoFuerzaBruta = null;

async function api(path, { timeout = REQUEST_TIMEOUT_MS, ...options } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeout),
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    assert.fail(`Respuesta no JSON en ${path} (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }

  return { status: response.status, json };
}

async function dashboard() {
  const { status, json } = await api('/api/dashboard');
  assert.equal(status, 200, 'GET /api/dashboard debe responder HTTP 200');
  assert.equal(json.ok, true, 'El dashboard respondió ok:false');
  return json.data;
}

async function agente(nombre) {
  const data = await dashboard();
  const encontrado = data.agentes.find((item) => item.nombre === nombre);
  assert.ok(encontrado, `No existe el agente "${nombre}" en agentes_estado`);
  return encontrado;
}

async function idsActivos() {
  const data = await dashboard();
  return new Set(data.casos_activos.map((caso) => caso.id));
}

async function nuevoCasoDesde(idsPrevios, log, { timeout = AI_TIMEOUT_MS } = {}) {
  const { status, json } = await api('/api/stream', {
    method: 'POST',
    timeout,
    body: JSON.stringify({ logs: [log] }),
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.data.procesados, 1);
  assert.equal(json.data.escalados, 1, `El log ${log.fuente}:${log.tipo_evento} debía escalarse`);

  const data = await dashboard();
  const creado = data.casos_activos.find((caso) => !idsPrevios.has(caso.id));

  assert.ok(creado, 'El caso escalado no aparece en /api/dashboard');
  casosCreados.push(creado.id);
  return creado;
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
    for (const id of casosCreados) {
      try {
        await api(`/api/cases/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ estado: 'falso_positivo' }),
        });
      } catch {
        // Limpieza best-effort: no debe ocultar el resultado de las pruebas.
      }
    }
  });

  it('expone un health check con D1 conectada', async () => {
    const { json } = await api('/api/health');

    assert.equal(json.data.database, 'D1 Conectada', 'D1 no está conectada: revisa el binding DB y la migración local');
    assert.match(json.data.status, /operativo/i);
  });

  it('descarta un log de ruido y actualiza las métricas del agente', async () => {
    const antes = await agente('Identidad');

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
    assert.deepEqual(json.data, { procesados: 1, escalados: 0, descartados: 1 });

    const despues = await agente('Identidad');
    assert.equal(despues.logs_procesados, antes.logs_procesados + 1, 'logs_procesados debe subir en 1');
    assert.equal(despues.logs_bloqueados, antes.logs_bloqueados + 1, 'logs_bloqueados debe subir en 1');
    assert.equal(despues.casos_escalados, antes.casos_escalados, 'un log filtrado no debe escalar');
  });

  it('escala una fuerza bruta como severidad alta y deja al agente en alerta', { timeout: AI_TIMEOUT_MS + 15000 }, async () => {
    const idsPrevios = await idsActivos();
    const antes = await agente('Identidad');

    const caso = await nuevoCasoDesde(idsPrevios, {
      fuente: 'identidad',
      tipo_evento: 'login_fallido',
      usuario: `smoke_${RUN_ID}`,
      ip: '10.255.255.2',
      intentos: 15,
    });

    assert.equal(caso.severidad, 'alta');
    assert.equal(caso.agente_responsable, 'Agente Identidad');
    assert.ok(caso.resumen_ia, 'El caso debe traer resumen_ia (real o fallback)');
    assert.ok(caso.recomendacion_ia, 'El caso debe traer recomendacion_ia');

    const despues = await agente('Identidad');
    assert.equal(despues.casos_escalados, antes.casos_escalados + 1);
    assert.equal(despues.estado, 'alerta');

    casoFuerzaBruta = caso.id;
  });

  it('escala PowerShell ofuscado como severidad crítica', { timeout: AI_TIMEOUT_MS + 15000 }, async () => {
    const caso = await nuevoCasoDesde(await idsActivos(), {
      fuente: 'endpoint',
      tipo_evento: 'powershell_encoded',
      host: 'WS-SMOKE',
      payload: 'powershell.exe -nop -w hidden -enc SQBFAFgA',
    });

    assert.equal(caso.severidad, 'critica');
    assert.equal(caso.agente_responsable, 'Agente Endpoint');
  });

  it('expone métricas consistentes para los gráficos', async () => {
    const data = await dashboard();
    const metricas = data.metricas;

    assert.ok(metricas, 'El dashboard debe incluir metricas');
    assert.ok(Array.isArray(metricas.ataques_por_tipo));
    assert.equal(metricas.agentes.length, 3);

    for (const agente of metricas.agentes) {
      assert.equal(typeof agente.escalados, 'number');
      assert.equal(typeof agente.atendidos, 'number');
      assert.equal(typeof agente.activos, 'number');
      assert.equal(
        agente.escalados,
        agente.atendidos + agente.activos,
        `${agente.nombre}: escalados debe ser igual a atendidos + activos`
      );
    }

    const totalTipo = metricas.ataques_por_tipo.reduce((suma, item) => suma + item.total, 0);
    const totalAgentes = metricas.agentes.reduce((suma, item) => suma + item.escalados, 0);

    assert.equal(totalTipo, totalAgentes, 'La torta debe sumar el mismo total que los agentes');

    if (data.casos_activos.length < 100) {
      for (const agente of metricas.agentes) {
        const activos = data.casos_activos.filter(
          (caso) => caso.agente_responsable === `Agente ${agente.nombre}`
        ).length;
        assert.equal(agente.activos, activos, `${agente.nombre}: activos no coincide con la cola`);
      }
    }
  });

  it('calcula la salud con la fórmula del SPEC', async () => {
    const data = await dashboard();
    const activos = data.casos_activos;

    // El dashboard lista hasta 100 casos: fuera de ese rango la fórmula no es verificable aquí.
    if (activos.length < 100) {
      const criticos = activos.filter((caso) => caso.severidad === 'critica').length;
      const altos = activos.filter((caso) => caso.severidad === 'alta').length;
      const esperado = Math.max(0, 100 - criticos * 20 - altos * 10);

      assert.equal(data.salud_sistema, esperado, 'La salud debe seguir 100 - 20·críticos - 10·altos');
    }

    assert.equal(typeof data.salud_sistema, 'number');
    assert.ok(data.salud_sistema >= 0 && data.salud_sistema <= 100);
    assert.ok(Array.isArray(data.agentes) && data.agentes.length >= 3, 'Faltan agentes: aplica seed.sql');
    assert.ok(Array.isArray(data.casos_activos));
  });

  it('permite resolver el caso y devuelve la nueva salud', async () => {
    assert.ok(casoFuerzaBruta, 'No hay caso de fuerza bruta creado por la prueba anterior');

    const { status, json } = await api(`/api/cases/${casoFuerzaBruta}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'contenido' }),
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.nuevo_estado, 'contenido');
    assert.equal(typeof json.data.salud_sistema, 'number');

    const activos = await idsActivos();
    assert.equal(activos.has(casoFuerzaBruta), false, 'El caso resuelto no debe seguir en casos_activos');

    const identidad = await agente('Identidad');
    assert.equal(identidad.estado, 'activo', 'Sin casos activos el agente vuelve a activo');
  });

  it('rechaza un estado de resolución inválido', async () => {
    assert.ok(casoFuerzaBruta, 'No hay caso para probar la validación');

    const { status, json } = await api(`/api/cases/${casoFuerzaBruta}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'inventado' }),
    });

    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'VALIDACION');
    assert.match(json.error, /Estado inválido/i);
  });

  it('devuelve 404 al resolver un caso inexistente', async () => {
    const { status, json } = await api(`/api/cases/no-existe-${RUN_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'contenido' }),
    });

    assert.equal(status, 404);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'NO_ENCONTRADO');
  });

  it('devuelve 404 JSON en rutas de API desconocidas', async () => {
    const { status, json } = await api('/api/ruta-inexistente');

    assert.equal(status, 404);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'NO_ENCONTRADO');
  });

  it('rechaza lotes con logs inválidos', async () => {
    const { status, json } = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({ logs: [{ fuente: 'satelite', tipo_evento: 'x' }] }),
    });

    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'VALIDACION');
    assert.match(json.error, /fuente/i);
  });
});
