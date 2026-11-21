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

const CREDENCIALES = {
  analista: { email: 'analista@soc-ia.demo', password: process.env.SOC_IA_PASSWORD || '' },
  admin: { email: 'admin@soc-ia.demo', password: process.env.SOC_IA_ADMIN_PASSWORD || '' },
};

// IP de origen única por corrida para que el dedupe no choque entre ejecuciones.
const IP_FUERZA_BRUTA = `198.51.100.${(parseInt(RUN_ID.slice(0, 2), 16) % 200) + 1}`;

/** Ids de los casos creados por esta corrida, para limpiarlos al final. */
const casosCreados = [];
let casoFuerzaBruta = null;

/** Cookie de sesión de la corrida. Node `fetch` no guarda cookies automáticamente. */
let cookie = '';

function cookieDe(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const cabecera of setCookies) {
    const [par] = cabecera.split(';');
    if (par.startsWith('soc_sid=')) return par;
  }
  return '';
}

function actualizarCookie(response) {
  const par = cookieDe(response);
  if (par) cookie = par;
}

async function api(path, { timeout = REQUEST_TIMEOUT_MS, headers = {}, cookie: cookieManual, guardarCookie = true, ...options } = {}) {
  const cookieEnviada = cookieManual !== undefined ? cookieManual : cookie;

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieEnviada ? { Cookie: cookieEnviada } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (guardarCookie) actualizarCookie(response);

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    assert.fail(`Respuesta no JSON en ${path} (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }

  return { status: response.status, json, cookie: cookieDe(response) };
}

async function loginComo(email, password) {
  const { status, json, cookie: nueva } = await api('/api/auth/login', {
    method: 'POST',
    cookie: '',
    guardarCookie: false,
    body: JSON.stringify({ email, password }),
  });

  assert.equal(status, 200, `Login falló para ${email}: ${json?.error || 'sin detalle'}`);
  assert.ok(nueva.startsWith('soc_sid='), 'El login debe devolver la cookie de sesión');
  return nueva;
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

async function ultimoSeq() {
  const { status, json } = await api('/api/logs?after=0&limit=1');
  assert.equal(status, 200, 'GET /api/logs debe responder HTTP 200');
  return json.data.logs.length ? json.data.logs[0].seq : 0;
}

async function logsDesde(seq, limit = 50) {
  const { status, json } = await api(`/api/logs?after=${seq}&limit=${limit}`);
  assert.equal(status, 200, 'GET /api/logs debe responder HTTP 200');
  return json.data.logs;
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

async function nuevoCasoDesdeIds(idsPrevios) {
  const data = await dashboard();
  const creado = data.casos_activos.find((caso) => !idsPrevios.has(caso.id));
  assert.ok(creado, 'No se encontró el caso nuevo en el dashboard');
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

    if (!CREDENCIALES.analista.password || !CREDENCIALES.admin.password) {
      throw new Error(
        'Faltan SOC_IA_PASSWORD y/o SOC_IA_ADMIN_PASSWORD.\n' +
          'Copiá tests/.env.example a tests/.env y completá las credenciales de demo antes de correr el suite.'
      );
    }

    // Estado limpio al inicio: evita que casos de corridas anteriores ensucien las aserciones.
    const adminCookie = await loginComo(CREDENCIALES.admin.email, CREDENCIALES.admin.password);
    const reset = await api('/api/demo/reset', {
      method: 'POST',
      cookie: adminCookie,
      guardarCookie: false,
    });
    assert.equal(reset.status, 200, 'No se pudo limpiar el estado inicial de la demo');
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

  it('rechaza el dashboard sin sesión', async () => {
    const { status, json } = await api('/api/dashboard', { guardarCookie: false });

    assert.equal(status, 401);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'NO_AUTENTICADO');

    const logs = await api('/api/logs', { guardarCookie: false });
    assert.equal(logs.status, 401);
    assert.equal(logs.json.code, 'NO_AUTENTICADO');
  });

  it('rechaza la ingesta de logs sin sesión', async () => {
    const { status, json } = await api('/api/stream', {
      method: 'POST',
      guardarCookie: false,
      body: JSON.stringify({ logs: [{ fuente: 'red', tipo_evento: 'escaneo_puertos' }] }),
    });

    assert.equal(status, 401);
    assert.equal(json.code, 'NO_AUTENTICADO');
  });

  it('rechaza credenciales incorrectas con un mensaje genérico', async () => {
    const { status, json } = await api('/api/auth/login', {
      method: 'POST',
      guardarCookie: false,
      body: JSON.stringify({ email: 'analista@soc-ia.demo', password: 'incorrecta123' }),
    });

    assert.equal(status, 401);
    assert.equal(json.code, 'CREDENCIALES');
    assert.match(json.error, /incorrectos/i);
  });

  it('permite el login con las credenciales de demo', async () => {
    const { status, json } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(CREDENCIALES.analista),
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.usuario.email, 'analista@soc-ia.demo');
    assert.equal(json.data.usuario.rol, 'analista');
    assert.ok(cookie.startsWith('soc_sid='), 'El login debe setear la cookie de sesión');

    const me = await api('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.data.usuario.email, 'analista@soc-ia.demo');
  });

  it('bloquea tras 5 intentos fallidos', { timeout: 60000 }, async () => {
    const email = `bloqueo_${RUN_ID}@soc-ia.demo`;

    for (let intento = 0; intento < 5; intento++) {
      const { status } = await api('/api/auth/login', {
        method: 'POST',
        guardarCookie: false,
        body: JSON.stringify({ email, password: 'incorrecta123' }),
      });
      assert.equal(status, 401, `El intento ${intento + 1} debía fallar`);
    }

    const bloqueado = await api('/api/auth/login', {
      method: 'POST',
      guardarCookie: false,
      body: JSON.stringify({ email, password: 'incorrecta123' }),
    });

    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.json.code, 'DEMASIADOS_INTENTOS');
  });

  it('rechaza una cookie de sesión inválida', async () => {
    const { status, json } = await api('/api/auth/me', {
      cookie: 'soc_sid=invalido',
      guardarCookie: false,
    });

    assert.equal(status, 401);
    assert.equal(json.code, 'NO_AUTENTICADO');
  });

  it('descarta un log de ruido y actualiza las métricas del agente', async () => {
    const antes = await agente('Identidad');
    const seqAntes = await ultimoSeq();

    const log = {
      fuente: 'identidad',
      tipo_evento: 'login_exitoso',
      usuario: `smoke_${RUN_ID}`,
      host: 'WS-ADM-11',
      destino_ip: '10.20.40.11',
      ip_origen: '10.255.255.1',
    };

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({ logs: [log] }),
    });

    assert.equal(status, 200);
    assert.deepEqual(json.data, {
      procesados: 1,
      escalados: 0,
      descartados: 1,
      casos_creados: 0,
      duplicados: 0,
    });

    const despues = await agente('Identidad');
    assert.equal(despues.logs_procesados, antes.logs_procesados + 1, 'logs_procesados debe subir en 1');
    assert.equal(despues.logs_bloqueados, antes.logs_bloqueados + 1, 'logs_bloqueados debe subir en 1');
    assert.equal(despues.casos_escalados, antes.casos_escalados, 'un log filtrado no debe escalar');

    const filas = await logsDesde(seqAntes);
    const fila = filas.find((item) => item.tipo_evento === 'login_exitoso');
    assert.ok(fila, 'El log debe persistirse');
    assert.equal(fila.fuente, 'identidad');
    assert.equal(fila.resultado, 'descartado');
    assert.equal(fila.host, 'WS-ADM-11');
  });

  it('escala una fuerza bruta como severidad alta y deja al agente en alerta', { timeout: AI_TIMEOUT_MS + 15000 }, async () => {
    const idsPrevios = await idsActivos();
    const antes = await agente('Identidad');
    const seqAntes = await ultimoSeq();

    const caso = await nuevoCasoDesde(idsPrevios, {
      fuente: 'identidad',
      tipo_evento: 'login_fallido',
      usuario: 'jefe.finanzas',
      host: 'WS-FAC-05',
      destino_ip: '10.20.50.5',
      ip_origen: IP_FUERZA_BRUTA,
      intentos: 15,
    });

    assert.equal(caso.severidad, 'alta');
    assert.equal(caso.agente_responsable, 'Agente Identidad');
    assert.ok(caso.resumen_ia, 'El caso debe traer resumen_ia (real o fallback)');
    assert.ok(caso.recomendacion_ia, 'El caso debe traer recomendacion_ia');
    assert.equal(caso.activo.hostname, 'WS-FAC-05');
    assert.equal(caso.activo.departamento, 'Facturación');
    assert.equal(caso.prioridad, 'P2');
    assert.equal(caso.usuario_perfil.nombre, 'Juan Pérez');
    assert.equal(caso.usuario_perfil.rol, 'Jefe de Finanzas');

    const despues = await agente('Identidad');
    assert.equal(despues.casos_escalados, antes.casos_escalados + 1);
    assert.equal(despues.estado, 'alerta');

    const filas = await logsDesde(seqAntes);
    const filaEscalada = filas.find((item) => item.resultado === 'escalado' && item.host === 'WS-FAC-05');
    assert.ok(filaEscalada, 'El log escalado debe persistirse');

    casoFuerzaBruta = caso.id;
  });

  it('no duplica casos del mismo ataque dentro del cooldown', async () => {
    const idsAntes = await idsActivos();
    const seqAntes = await ultimoSeq();

    const log = {
      fuente: 'identidad',
      tipo_evento: 'login_fallido',
      usuario: 'jefe.finanzas',
      host: 'WS-FAC-05',
      destino_ip: '10.20.50.5',
      ip_origen: IP_FUERZA_BRUTA,
      intentos: 15,
    };

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({ logs: [log, log] }),
    });

    assert.equal(status, 200);
    assert.equal(json.data.escalados, 2);
    assert.equal(json.data.casos_creados, 0);
    assert.equal(json.data.duplicados, 2);

    const idsDespues = await idsActivos();
    assert.equal(idsDespues.size, idsAntes.size, 'No debe crear casos nuevos');

    const data = await dashboard();
    const caso = data.casos_activos.find((item) => item.id === casoFuerzaBruta);
    assert.ok(caso, 'El caso original debe seguir activo');
    assert.ok(Number(caso.ocurrencias) >= 3, 'Las ocurrencias deben acumularse');

    const filas = await logsDesde(seqAntes);
    assert.equal(
      filas.filter((item) => item.resultado === 'duplicado').length,
      2,
      'Los logs duplicados deben persistirse como tales'
    );
  });

  it('escala PowerShell ofuscado como severidad crítica', { timeout: AI_TIMEOUT_MS + 15000 }, async () => {
    const caso = await nuevoCasoDesde(await idsActivos(), {
      fuente: 'endpoint',
      tipo_evento: 'powershell_encoded',
      host: 'SRV-HIS-01',
      destino_ip: '10.20.80.11',
      usuario: 'admin.ti',
      ip_origen: '203.0.113.50',
      payload: 'powershell.exe -nop -w hidden -enc SQBFAFgA',
    });

    assert.equal(caso.severidad, 'critica');
    assert.equal(caso.agente_responsable, 'Agente Endpoint');
    assert.equal(caso.activo.hostname, 'SRV-HIS-01');
    assert.equal(caso.activo.departamento, 'TI');
    assert.equal(caso.prioridad, 'P1');
    assert.equal(caso.usuario_perfil.nombre, 'Nicolás Herrera');
    assert.equal(caso.usuario_perfil.rol, 'Administrador de Sistemas');
  });

  it('limita las inferencias por lote y marca el resumen de respaldo', { timeout: 90000 }, async () => {
    const idsAntes = await idsActivos();
    const logs = Array.from({ length: 5 }, (_, indice) => ({
      fuente: 'endpoint',
      tipo_evento: 'powershell_encoded',
      host: `WS-CAP-${indice}`,
      payload: 'powershell.exe -enc SQBFAFgA',
    }));

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      timeout: 60000,
      body: JSON.stringify({ logs }),
    });

    assert.equal(status, 200);
    assert.equal(json.data.casos_creados, 5);

    const data = await dashboard();
    const nuevos = data.casos_activos.filter(
      (caso) => !idsAntes.has(caso.id) && caso.agente_responsable === 'Agente Endpoint'
    );

    assert.equal(nuevos.length, 5, 'Deben crearse 5 casos distintos');

    const respaldos = nuevos.filter((caso) => caso.resumen_fuente === 'fallback');
    assert.ok(respaldos.length >= 2, 'El tope de 3 inferencias debe dejar al menos 2 con respaldo');

    for (const caso of nuevos) casosCreados.push(caso.id);
  });

  it('resuelve el activo por IP cuando falta el host', async () => {
    const idsAntes = await idsActivos();

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({
        logs: [
          {
            fuente: 'identidad',
            tipo_evento: 'login_fallido',
            usuario: 'guardia.turno',
            destino_ip: '10.20.10.13',
            ip_origen: '198.51.100.44',
            intentos: 15,
          },
        ],
      }),
    });

    assert.equal(status, 200);
    assert.equal(json.data.casos_creados, 1);

    const caso = await nuevoCasoDesdeIds(idsAntes);
    assert.equal(caso.activo.hostname, 'WS-GUARDIA-03');
    assert.equal(caso.activo.departamento, 'Guardia');
    assert.equal(caso.usuario_perfil.nombre, 'Carla Ríos');

    const evidencia = JSON.parse(caso.evidencia_json);
    assert.equal(evidencia.destino_ip, '10.20.10.13');
    assert.equal(evidencia.usuario, 'guardia.turno');
    assert.ok(caso.evidencia_json.length <= 500, 'La evidencia debe estar acotada');

    casosCreados.push(caso.id);

    // Se resuelve para no dejar un caso de Identidad activo antes del triage.
    await api(`/api/cases/${caso.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'falso_positivo' }),
    });
  });

  it('marca como desconocido un activo fuera del inventario', async () => {
    const idsAntes = await idsActivos();

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({
        logs: [
          {
            fuente: 'endpoint',
            tipo_evento: 'powershell_encoded',
            host: 'WS-INEXISTENTE-99',
            usuario: `externo.${RUN_ID}`,
            ip_origen: '203.0.113.99',
            payload: 'powershell.exe -enc SQBFAFgA',
          },
        ],
      }),
    });

    assert.equal(status, 200);
    assert.equal(json.data.casos_creados, 1);

    const caso = await nuevoCasoDesdeIds(idsAntes);
    assert.equal(caso.activo, null);
    assert.equal(caso.prioridad, 'P2', 'Sin activo se asume criticidad media');
    assert.equal(caso.usuario_perfil, null, 'Sin usuario en el directorio no hay perfil');

    casosCreados.push(caso.id);
  });

  it('crea un caso por cada activo afectado', { timeout: AI_TIMEOUT_MS + 15000 }, async () => {
    const idsAntes = await idsActivos();
    const base = {
      fuente: 'endpoint',
      tipo_evento: 'powershell_encoded',
      payload: 'powershell.exe -enc SQBFAFgA',
    };

    const { status, json } = await api('/api/stream', {
      method: 'POST',
      timeout: AI_TIMEOUT_MS,
      body: JSON.stringify({
        logs: [
          {
            ...base,
            host: 'WS-LAB-07',
            destino_ip: '10.20.20.7',
            usuario: 'bioq.lab',
            ip_origen: '203.0.113.61',
          },
          {
            ...base,
            host: 'WS-IMG-02',
            destino_ip: '10.20.30.2',
            usuario: 'tecnico.img',
            ip_origen: '203.0.113.62',
          },
        ],
      }),
    });

    assert.equal(status, 200);
    assert.equal(json.data.casos_creados, 2);
    assert.equal(json.data.duplicados, 0);

    const data = await dashboard();
    const nuevos = data.casos_activos.filter((caso) => !idsAntes.has(caso.id));

    assert.equal(nuevos.length, 2);
    assert.deepEqual(
      nuevos.map((caso) => caso.activo.hostname).sort(),
      ['WS-IMG-02', 'WS-LAB-07'],
      'Cada activo debe generar su propio caso'
    );

    const perfiles = nuevos.map((caso) => caso.usuario_perfil.nombre).sort();
    assert.deepEqual(perfiles, ['Lucía Fernández', 'Martín Gómez']);

    for (const caso of nuevos) casosCreados.push(caso.id);
  });

  it('pagina los logs con un cursor incremental', async () => {
    const { status, json } = await api('/api/logs?after=0&limit=1');
    assert.equal(status, 200);
    const seq = json.data.siguiente;

    const stream = await api('/api/stream', {
      method: 'POST',
      body: JSON.stringify({
        logs: [{ fuente: 'red', tipo_evento: 'request_normal', host: 'SRV-WEB-01', destino_ip: '10.20.80.18' }],
      }),
    });
    assert.equal(stream.status, 200);

    const { json: pagina } = await api(`/api/logs?after=${seq}&limit=10`);
    assert.equal(pagina.data.logs.length, 1);
    assert.equal(pagina.data.logs[0].resultado, 'descartado');
    assert.equal(pagina.data.logs[0].host, 'SRV-WEB-01');
    assert.ok(pagina.data.siguiente > seq);
  });

  it('filtra el historial por fuente y resultado', async () => {
    const endpoint = await api('/api/logs?sentido=desc&fuente=endpoint&limit=20');
    assert.equal(endpoint.status, 200);
    assert.ok(endpoint.json.data.logs.length > 0, 'Debe haber logs de endpoint');
    assert.ok(endpoint.json.data.logs.every((log) => log.fuente === 'endpoint'));

    const escalados = await api('/api/logs?sentido=desc&resultado=escalado&limit=20');
    assert.ok(escalados.json.data.logs.length > 0, 'Debe haber logs escalados');
    assert.ok(escalados.json.data.logs.every((log) => log.resultado === 'escalado'));
  });

  it('filtra el historial por host, usuario y texto libre', async () => {
    const porHost = await api('/api/logs?sentido=desc&host=srv-his&limit=10');
    assert.ok(porHost.json.data.logs.length > 0);
    assert.ok(porHost.json.data.logs.every((log) => (log.host || '').toLowerCase().includes('srv-his')));

    const porUsuario = await api('/api/logs?sentido=desc&usuario=admin.ti&limit=10');
    assert.ok(porUsuario.json.data.logs.length > 0);
    assert.ok(porUsuario.json.data.logs.every((log) => (log.usuario || '').toLowerCase().includes('admin.ti')));

    const porTexto = await api('/api/logs?sentido=desc&q=powershell&limit=10');
    assert.ok(porTexto.json.data.logs.length > 0);
  });

  it('pagina el historial hacia atrás sin solaparse', async () => {
    const primera = await api('/api/logs?sentido=desc&limit=2');
    assert.equal(primera.status, 200);
    assert.equal(primera.json.data.logs.length, 2);
    assert.ok(primera.json.data.anterior, 'Debe haber un cursor para anteriores');

    const segunda = await api(`/api/logs?sentido=desc&limit=2&before=${primera.json.data.anterior}`);
    assert.equal(segunda.status, 200);
    assert.ok(segunda.json.data.logs.length > 0);
    assert.ok(segunda.json.data.logs.every((log) => log.seq < primera.json.data.anterior));
  });

  it('exporta los logs filtrados en CSV', async () => {
    const respuesta = await fetch(`${BASE_URL}/api/logs?format=csv&fuente=red`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    assert.equal(respuesta.status, 200);
    assert.match(respuesta.headers.get('content-type') || '', /text\/csv/);

    const lineas = (await respuesta.text()).trim().split('\n');
    assert.match(lineas[0], /^seq,timestamp,fuente/);
    assert.ok(lineas.length > 1, 'El CSV debe incluir filas');
    assert.ok(lineas.slice(1).every((linea) => linea.includes(',"red",')));
  });

  it('rechaza filtros inválidos del explorador', async () => {
    const { status, json } = await api('/api/logs?fuente=satelite');
    assert.equal(status, 400);
    assert.equal(json.code, 'VALIDACION');
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

  it('aplica rate limit por usuario en la ingesta', { timeout: 120000 }, async () => {
    const adminCookie = await loginComo(CREDENCIALES.admin.email, CREDENCIALES.admin.password);
    const log = { fuente: 'red', tipo_evento: 'request_normal', ip: '10.0.0.1' };

    for (let intento = 0; intento < 30; intento++) {
      const { status } = await api('/api/stream', {
        method: 'POST',
        cookie: adminCookie,
        guardarCookie: false,
        body: JSON.stringify({ logs: [log] }),
      });
      assert.equal(status, 200, `La petición ${intento + 1} debía pasar`);
    }

    const bloqueado = await api('/api/stream', {
      method: 'POST',
      cookie: adminCookie,
      guardarCookie: false,
      body: JSON.stringify({ logs: [log] }),
    });

    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.json.code, 'DEMASIADAS_PETICIONES');
  });

  it('reserva el reset de demo para administradores', async () => {
    const { status, json } = await api('/api/demo/reset', { method: 'POST' });

    assert.equal(status, 403);
    assert.equal(json.code, 'PROHIBIDO');
  });

  it('reinicia la demo y deja el SOC en verde', async () => {
    const adminCookie = await loginComo(CREDENCIALES.admin.email, CREDENCIALES.admin.password);

    const reset = await api('/api/demo/reset', {
      method: 'POST',
      cookie: adminCookie,
      guardarCookie: false,
    });

    assert.equal(reset.status, 200);
    assert.ok(reset.json.data.casos_eliminados >= 1);
    assert.equal(reset.json.data.salud_sistema, 100);

    const data = await dashboard();
    assert.equal(data.salud_sistema, 100);
    assert.equal(data.casos_activos.length, 0);

    for (const agente of data.agentes) {
      assert.equal(agente.estado, 'activo');
      assert.equal(agente.logs_procesados, 0);
    }

    const logs = await logsDesde(0);
    assert.equal(logs.length, 0, 'El reset debe borrar los logs');
  });

  it('invalida la sesión al cerrar sesión', async () => {
    const salida = await api('/api/auth/logout', { method: 'POST' });
    assert.equal(salida.status, 200);

    const me = await api('/api/auth/me');
    assert.equal(me.status, 401);

    // Restaurar la sesión para que la limpieza final pueda resolver los casos.
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(CREDENCIALES.analista),
    });
    assert.equal(login.status, 200);
  });
});
