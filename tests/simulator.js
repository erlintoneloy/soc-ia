#!/usr/bin/env node
'use strict';

/**
 * Simulador de lluvia de logs para SOC-IA.
 *
 * Envía lotes de eventos sintéticos al endpoint POST /api/stream del Worker
 * y muestra el resumen devuelto por el motor de agentes.
 *
 * Uso:
 *   node tests/simulator.js --scenario mixto --logs 20 --rate 10
 *
 * No contiene datos personales reales ni secretos.
 */

const { randomUUID } = require('node:crypto');

const DEFAULT_URL = process.env.SOC_IA_URL || 'http://127.0.0.1:8787';
const SCENARIOS = ['mixto', 'ruido', 'fuerza-bruta', 'escaneo', 'powershell', 'desconocido', 'flood'];
const BATCH_SIZE = 25;

const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (color, text) => (useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text);

function fail(message) {
  console.error(`\n${paint('red', 'Error:')} ${message}\n`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  console.log(`Simulador de logs SOC-IA

  node tests/simulator.js [opciones]

Opciones:
  --url <url>          URL base del Worker (default: ${DEFAULT_URL})
  --logs <n>           Cantidad total de logs a enviar (default: 20)
  --rate <n>           Logs por segundo; 0 = sin pausa (default: 10)
  --scenario <nombre>  ${SCENARIOS.join(' | ')} (default: mixto)
  --dry-run            Genera y muestra los logs sin enviarlos
  --quiet              No imprime cada log, solo el resumen
  --email <email>      Usuario para autenticarse (default: analista@soc-ia.demo)
  --password <clave>   Contraseña del usuario (o SOC_IA_PASSWORD)
  -h, --help           Muestra esta ayuda

Variables de entorno:
  SOC_IA_URL           URL base del Worker (equivale a --url)
  SOC_IA_EMAIL         Usuario para autenticarse
  SOC_IA_PASSWORD      Contraseña del usuario (se carga desde .env)
  NO_COLOR             Desactiva los colores de la salida
`);
}

function parseIntInRange(raw, flag, { min, max }) {
  if (!/^\d+$/.test(raw)) fail(`${flag} espera un entero, recibió "${raw}"`);
  const value = Number(raw);
  if (value < min || value > max) fail(`${flag} debe estar entre ${min} y ${max}`);
  return value;
}

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_URL,
    logs: 20,
    rate: 10,
    scenario: 'mixto',
    dryRun: false,
    quiet: false,
    email: process.env.SOC_IA_EMAIL || 'analista@soc-ia.demo',
    password: process.env.SOC_IA_PASSWORD || '',
  };

  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=');

    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[++i];
      if (next === undefined) fail(`La opción ${flag} requiere un valor`);
      return next;
    };

    switch (flag) {
      case '--url':
        opts.url = takeValue().replace(/\/+$/, '');
        break;
      case '--logs':
        opts.logs = parseIntInRange(takeValue(), flag, { min: 1, max: 10000 });
        break;
      case '--rate':
        opts.rate = parseIntInRange(takeValue(), flag, { min: 0, max: 1000 });
        break;
      case '--scenario': {
        const scenario = takeValue();
        if (!SCENARIOS.includes(scenario)) {
          fail(`Escenario desconocido "${scenario}". Válidos: ${SCENARIOS.join(', ')}`);
        }
        opts.scenario = scenario;
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--email':
        opts.email = takeValue();
        break;
      case '--password':
        opts.password = takeValue();
        break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        fail(`Opción desconocida: ${argv[i]}`);
    }
  }

  return opts;
}

function randomIp() {
  return `10.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
}

function attackLog(scenario, index, runId) {
  switch (scenario) {
    case 'fuerza-bruta':
      return {
        severity: 'alta',
        log: {
          fuente: 'identidad',
          tipo_evento: 'login_fallido',
          usuario: 'jefe.finanzas',
          host: 'WS-FAC-05',
          destino_ip: '10.20.50.5',
          ip_origen: '198.51.100.23',
          intentos: 8 + (index % 10),
        },
      };
    case 'escaneo':
      return {
        severity: 'alta',
        log: {
          fuente: 'red',
          tipo_evento: 'escaneo_puertos',
          host: 'FW-PERIMETRO-01',
          destino_ip: '10.20.80.1',
          ip_origen: '203.0.113.45',
          puertos: [22, 80, 443, 3389, 8080],
        },
      };
    case 'powershell': {
      const objetivos = [
        { host: 'WS-GUARDIA-03', ip: '10.20.10.13', usuario: 'guardia.turno' },
        { host: 'WS-LAB-07', ip: '10.20.20.7', usuario: 'bioq.lab' },
        { host: 'WS-IMG-02', ip: '10.20.30.2', usuario: 'tecnico.img' },
      ];
      const objetivo = objetivos[index % objetivos.length];

      return {
        severity: 'critica',
        log: {
          fuente: 'endpoint',
          tipo_evento: 'powershell_encoded',
          host: objetivo.host,
          destino_ip: objetivo.ip,
          usuario: objetivo.usuario,
          ip_origen: '198.51.100.77',
          payload: 'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA',
        },
      };
    }
    case 'desconocido':
      return {
        severity: 'critica',
        log: {
          fuente: 'endpoint',
          tipo_evento: 'powershell_encoded',
          host: 'WS-DESCONOCIDO-99',
          usuario: `externo_${runId}`,
          ip_origen: '203.0.113.99',
          payload: 'powershell.exe -enc SQBFAFgA',
        },
      };
    case 'flood':
      return {
        severity: 'baja',
        log: {
          fuente: 'red',
          tipo_evento: 'request_normal',
          host: 'SRV-WEB-01',
          destino_ip: '10.20.80.18',
          ip_origen: '203.0.113.200',
          bytes: 1500,
        },
      };
    default:
      throw new Error(`Escenario sin generador: ${scenario}`);
  }
}

function noiseLog(index) {
  const variantes = [
    {
      fuente: 'identidad',
      tipo_evento: 'login_exitoso',
      usuario: 'admision.01',
      host: 'WS-ADM-11',
      destino_ip: '10.20.40.11',
      ip_origen: randomIp(),
    },
    {
      fuente: 'identidad',
      tipo_evento: 'login_fallido',
      usuario: 'guardia.turno',
      host: 'WS-GUARDIA-03',
      destino_ip: '10.20.10.13',
      ip_origen: randomIp(),
      intentos: 1,
    },
    {
      fuente: 'red',
      tipo_evento: 'request_normal',
      host: 'SRV-WEB-01',
      destino_ip: '10.20.80.18',
      ip_origen: randomIp(),
      bytes: 1024 + index,
    },
    {
      fuente: 'endpoint',
      tipo_evento: 'proceso_firmado',
      host: 'WS-RRHH-04',
      destino_ip: '10.20.70.4',
      usuario: 'rrhh.01',
      firma: 'Microsoft Corporation',
    },
  ];

  return { severity: 'baja', log: variantes[index % variantes.length] };
}

function buildLogs({ scenario, logs }, runId) {
  // En mixto >= 8, el lote arranca con una ráfaga real de fuerza bruta que supera el umbral.
  if (scenario === 'mixto' && logs >= 8) {
    const lote = [];
    for (let i = 0; i < 6; i++) lote.push(attackLog('fuerza-bruta', i, runId));
    lote.push(attackLog('escaneo', 0, runId));
    lote.push(attackLog('powershell', 0, runId));
    for (let i = lote.length; i < logs; i++) lote.push(noiseLog(i));
    return lote;
  }

  const generated = [];
  const attackScenarios = ['fuerza-bruta', 'escaneo', 'powershell'];

  for (let i = 0; i < logs; i++) {
    if (scenario === 'ruido') {
      generated.push(noiseLog(i));
      continue;
    }

    if (scenario === 'mixto') {
      const isAttack = i % 4 === 0;
      const attackIndex = (i / 4) % attackScenarios.length;
      generated.push(isAttack ? attackLog(attackScenarios[attackIndex], i, runId) : noiseLog(i));
      continue;
    }

    generated.push(attackLog(scenario, i, runId));
  }

  return generated;
}

function describeLog({ severity, log }) {
  const source = log.fuente.toUpperCase();
  const detail = log.usuario || log.host || log.ip || '';
  const color = severity === 'critica' ? 'red' : severity === 'alta' ? 'yellow' : 'dim';
  return paint(color, `${source.padEnd(9)} ${log.tipo_evento.padEnd(20)} ${detail}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function iniciarSesion(url, email, password) {
  if (!password) {
    console.error(`\n${paint('red', 'Falta la contraseña de demo.')}`);
    console.error('Definí SOC_IA_PASSWORD en .env o pasá --password.\n');
    process.exit(2);
  }

  let response;

  try {
    response = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    console.error(`\n${paint('red', 'No se pudo conectar al Worker:')} ${error.message}`);
    console.error(`Verifica que "npm run dev" esté corriendo y que la URL sea ${url}\n`);
    process.exit(1);
  }

  const texto = await response.text();
  let json = null;

  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }

  if (!response.ok || !json?.ok) {
    console.error(
      `\n${paint('red', `No se pudo iniciar sesión como ${email}:`)} ${json?.error || `HTTP ${response.status}`}`
    );
    console.error('Pasá --email y --password (o SOC_IA_EMAIL / SOC_IA_PASSWORD).\n');
    process.exit(1);
  }

  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const cookie = setCookies.map((cabecera) => cabecera.split(';')[0]).find((par) => par.startsWith('soc_sid='));

  if (!cookie) {
    console.error(`\n${paint('red', 'El login no devolvió la cookie de sesión.')}\n`);
    process.exit(1);
  }

  return { cookie, usuario: json.data.usuario };
}

async function postLogs(url, logs, cookie) {
  let response;

  try {
    response = await fetch(`${url}/api/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ logs }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    console.error(`\n${paint('red', 'No se pudo conectar al Worker:')} ${error.message}`);
    console.error(`Verifica que "npx wrangler dev" esté corriendo en worker/ y que la URL sea ${url}\n`);
    process.exit(1);
  }

  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch {
    console.error(`\n${paint('red', `Respuesta no JSON (HTTP ${response.status}):`)} ${text.slice(0, 300)}\n`);
    process.exit(1);
  }

  if (!response.ok || !json.ok) {
    console.error(`\n${paint('red', `El Worker respondió HTTP ${response.status}:`)} ${json.error || text}\n`);
    process.exit(1);
  }

  return json.data;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runId = randomUUID().slice(0, 8);
  const generated = buildLogs(opts, runId);

  console.log(`\n${paint('cyan', 'SOC-IA · Simulador de logs')}`);
  console.log(`${paint('dim', `Destino: ${opts.url}   Escenario: ${opts.scenario}   Logs: ${opts.logs}   Rate: ${opts.rate}/s   Run: ${runId}`)}\n`);

  if (opts.dryRun) {
    for (const item of generated) console.log(`  ${describeLog(item)}`);
    console.log(`\n${paint('yellow', 'Dry run: no se envió nada al Worker.')}\n`);
    return;
  }

  const { cookie, usuario } = await iniciarSesion(opts.url, opts.email, opts.password);
  console.log(`${paint('green', 'Sesión iniciada como')} ${usuario.nombre} (${usuario.rol})\n`);

  const totals = {
    procesados: 0,
    escalados: 0,
    descartados: 0,
    observados: 0,
    bloqueados: 0,
    casos_creados: 0,
    duplicados: 0,
  };
  const startedAt = Date.now();
  const batchSize = opts.rate > 0 ? Math.min(BATCH_SIZE, Math.max(1, Math.ceil(opts.rate))) : BATCH_SIZE;
  let sent = 0;

  for (let offset = 0; offset < generated.length; offset += batchSize) {
    const batch = generated.slice(offset, offset + batchSize);
    const batchStartedAt = Date.now();

    if (!opts.quiet) {
      for (const item of batch) console.log(`  ${paint('dim', new Date().toLocaleTimeString())}  ${describeLog(item)}`);
    }

    const data = await postLogs(opts.url, batch.map((item) => item.log), cookie);
    sent += batch.length;
    totals.procesados += data.procesados ?? 0;
    totals.escalados += data.escalados ?? 0;
    totals.descartados += data.descartados ?? 0;
    totals.observados += data.observados ?? 0;
    totals.bloqueados += data.bloqueados ?? 0;
    totals.casos_creados += data.casos_creados ?? 0;
    totals.duplicados += data.duplicados ?? 0;

    if (!opts.quiet) {
      console.log(
        `  ${paint('green', '↳ lote')} ${batch.length} logs → ` +
          `${data.procesados ?? 0} procesados, ${data.escalados ?? 0} escalados, ${data.descartados ?? 0} descartados\n`
      );
    }

    if (opts.rate > 0 && offset + batchSize < generated.length) {
      const targetMs = (batch.length / opts.rate) * 1000;
      const elapsed = Date.now() - batchStartedAt;
      if (targetMs > elapsed) await sleep(targetMs - elapsed);
    }
  }

  const durationMs = Date.now() - startedAt;
  const throughput = durationMs > 0 ? (sent / (durationMs / 1000)).toFixed(1) : '∞';

  console.log(paint('cyan', '─'.repeat(58)));
  console.log(`  Enviados     ${sent}`);
  console.log(`  Procesados   ${totals.procesados}`);
  console.log(`  Escalados    ${paint('yellow', String(totals.escalados))}`);
  console.log(`  Casos nuevos ${paint('yellow', String(totals.casos_creados))}`);
  console.log(`  Duplicados   ${paint('dim', String(totals.duplicados))}`);
  console.log(`  Observados   ${paint('dim', String(totals.observados))}`);
  console.log(`  Bloqueados   ${paint('cyan', String(totals.bloqueados))}`);
  console.log(`  Descartados  ${paint('green', String(totals.descartados))}`);
  console.log(`  Duración     ${(durationMs / 1000).toFixed(2)}s (${throughput} logs/s)`);
  console.log(paint('cyan', '─'.repeat(58)) + '\n');

  if (totals.procesados !== sent) {
    console.error(paint('red', `Advertencia: el Worker procesó ${totals.procesados} de ${sent} logs enviados.\n`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n${paint('red', 'Fallo inesperado:')} ${error.stack || error.message}\n`);
  process.exit(1);
});
