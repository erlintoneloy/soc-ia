import { manejarLogin, manejarLogout, usuarioDesdeRequest } from './auth.js';
import { registrarAuditoria } from './auditoria.js';
import {
  AGENTE_POR_FUENTE,
  RESULTADOS,
  UMBRAL_AUTO_BLOQUEO,
  UMBRAL_FUERZA_BRUTA,
  VENTANA_DETECCION_MS,
  calcularPrioridad,
  claveDedupe,
  evaluarEvento,
  superaUmbral,
} from './engine.js';

const ESTADOS_RESOLUCION = ['contenido', 'falso_positivo'];
const ESTADOS_ACTIVOS = "('escalado', 'en_triaje')";
const MAX_LOGS_POR_LOTE = 100;
const MAX_SENTENCIAS_POR_BATCH = 50;
const MAX_IA_POR_LOTE = 3;
const MAX_STREAM_POR_MINUTO = 30;
const MAX_PATCH_POR_MINUTO = 60;
const COOLDOWN_DEDUPE_MS = 60 * 1000;
const CRITICIDAD_POR_DEFECTO = 'media';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function error(status, mensaje, code) {
  return json({ ok: false, error: mensaje, code }, status);
}

function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, (caracter) => {
    const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return mapa[caracter];
  });
}

function paginaNoEncontrada(pathname) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 · SOC-IA</title>
  <style>
    :root { color-scheme: dark; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { min-height: 100vh; display: grid; place-items: center; background: #0b1120; color: #f3f4f6; font-family: 'Inter', system-ui, sans-serif; padding: 2rem; }
    .card { max-width: 520px; text-align: center; background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 3rem 2rem; }
    .code { font-size: 4rem; font-weight: 800; color: #0ea5e9; line-height: 1; }
    h1 { font-size: 1.25rem; margin: 1rem 0 0.5rem; }
    p { color: #9ca3af; font-size: 0.9rem; line-height: 1.6; margin-top: 0.5rem; }
    code { font-family: 'JetBrains Mono', 'Courier New', monospace; color: #f97316; word-break: break-all; }
    a { display: inline-block; margin-top: 1.5rem; background: #0ea5e9; color: #fff; text-decoration: none; font-weight: 700; padding: 0.6rem 1.2rem; border-radius: 6px; }
    a:hover { background: #0284c7; }
  </style>
</head>
<body>
  <main class="card">
    <div class="code">404</div>
    <h1>Fuera del perímetro</h1>
    <p>La ruta <code>${escaparHtml(pathname)}</code> no existe en este Worker.</p>
    <p>Si buscabas la API, consulta los endpoints disponibles en el dashboard.</p>
    <a href="/">Volver al SOC</a>
  </main>
</body>
</html>`;
}

function validarLog(log, indice) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) {
    return `logs[${indice}] debe ser un objeto`;
  }
  if (!AGENTE_POR_FUENTE[log.fuente]) {
    return `logs[${indice}].fuente debe ser red, identidad o endpoint`;
  }
  if (typeof log.tipo_evento !== 'string' || !log.tipo_evento.trim()) {
    return `logs[${indice}].tipo_evento es obligatorio`;
  }

  for (const campo of ['host', 'destino_ip', 'ip_origen', 'ip', 'usuario']) {
    if (log[campo] === undefined || log[campo] === null) continue;
    if (typeof log[campo] !== 'string' || log[campo].length > 120) {
      return `logs[${indice}].${campo} debe ser un texto de hasta 120 caracteres`;
    }
  }

  return null;
}

async function generarResumenIA(env, { titulo, agente, severidad, log, contexto }) {
  const fallback = {
    resumen: `${titulo} detectado por el Agente ${agente}. Requiere revisión manual.`,
    recomendacion: 'Aislar el activo afectado y revisar los logs.',
    fuente: 'fallback',
  };

  try {
    const respuesta = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        {
          role: 'system',
          content:
            'Eres un Analista SOC Senior. Responde ESTRICTAMENTE en formato JSON con esta estructura: ' +
            '{"resumen": "explicacion en 2 lineas", "recomendacion": "accion tecnica en 1 linea"}. ' +
            'No agregues markdown ni texto extra.',
        },
        {
          role: 'user',
          content:
            `Evento: ${titulo} (severidad ${severidad}) detectado por el Agente ${agente}. ` +
            `Datos: ${JSON.stringify(log)}. ${contexto || ''}`,
        },
      ],
    });

    const texto = respuesta?.choices?.[0]?.message?.content ?? respuesta?.response ?? '';
    if (!texto) return fallback;

    const parseado = JSON.parse(texto.replace(/```json|```/g, '').trim());
    return {
      resumen: typeof parseado.resumen === 'string' && parseado.resumen ? parseado.resumen : fallback.resumen,
      recomendacion:
        typeof parseado.recomendacion === 'string' && parseado.recomendacion
          ? parseado.recomendacion
          : fallback.recomendacion,
      fuente: 'ia',
    };
  } catch (aiError) {
    // Observabilidad sin payload ni PII: solo el motivo del fallback.
    console.warn(`[SOC-IA] Workers AI no disponible, se usa resumen de respaldo: ${aiError.message}`);
    return fallback;
  }
}

async function recalcularSalud(env, tenantId, logsPorSegundo = null) {
  const { results } = await env.DB.prepare(
    `SELECT severidad, COUNT(*) AS total
       FROM casos
      WHERE tenant_id = ? AND estado IN ${ESTADOS_ACTIVOS}
      GROUP BY severidad`
  )
    .bind(tenantId)
    .all();

  const totales = Object.fromEntries(results.map((fila) => [fila.severidad, fila.total]));
  const criticos = totales.critica ?? 0;
  const altos = totales.alta ?? 0;
  const amenazas = criticos + altos + (totales.media ?? 0) + (totales.baja ?? 0);
  const salud = Math.max(0, Math.min(100, 100 - criticos * 20 - altos * 10));
  const ahora = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO sistema_salud (tenant_id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
       VALUES (?, 100, 0, 0, ?)`
    ).bind(tenantId, ahora),
    env.DB.prepare(
      `UPDATE sistema_salud
          SET salud_porcentaje = ?, amenazas_activas = ?, logs_por_segundo = COALESCE(?, logs_por_segundo), actualizado_en = ?
        WHERE tenant_id = ?`
    ).bind(salud, amenazas, logsPorSegundo, ahora, tenantId),
    env.DB.prepare(
      `UPDATE agentes_estado
          SET estado = CASE
            WHEN nombre IN (
              SELECT REPLACE(agente_responsable, 'Agente ', '')
                FROM casos
               WHERE tenant_id = ? AND estado IN ${ESTADOS_ACTIVOS}
            ) THEN 'alerta'
            ELSE 'activo'
          END
        WHERE tenant_id = ?`
    ).bind(tenantId, tenantId),
  ]);

  return salud;
}

async function insertarCasos(env, casos) {
  const sentencias = casos.map((caso) =>
    env.DB.prepare(
      `INSERT INTO casos (id, tenant_id, titulo, severidad, agente_responsable, resumen_ia, recomendacion_ia,
                          estado, creado_en, clave_dedupe, ocurrencias, ultima_ocurrencia, resumen_fuente,
                          activo_id, tipo_evento, ip_origen, usuario_afectado, evidencia_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'escalado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      caso.id,
      caso.tenant_id,
      caso.titulo,
      caso.severidad,
      caso.agente,
      caso.resumen,
      caso.recomendacion,
      caso.creado_en,
      caso.clave_dedupe,
      caso.ocurrencias,
      caso.ultima_ocurrencia,
      caso.resumen_fuente,
      caso.activo_id,
      caso.tipo_evento,
      caso.ip_origen,
      caso.usuario_afectado,
      caso.evidencia_json
    )
  );

  for (let i = 0; i < sentencias.length; i += MAX_SENTENCIAS_POR_BATCH) {
    await env.DB.batch(sentencias.slice(i, i + MAX_SENTENCIAS_POR_BATCH));
  }
}

async function consumirLimite(env, clave, maximo, ventanaMs) {
  const ventana = Math.floor(Date.now() / ventanaMs);
  const ahora = new Date().toISOString();

  const fila = await env.DB.prepare(`SELECT ventana, contador FROM rate_limit WHERE clave = ?`)
    .bind(clave)
    .first();

  if (!fila || Number(fila.ventana) !== ventana) {
    await env.DB.prepare(
      `INSERT INTO rate_limit (clave, ventana, contador, actualizado_en)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(clave) DO UPDATE SET
         ventana = excluded.ventana,
         contador = 1,
         actualizado_en = excluded.actualizado_en`
    )
      .bind(clave, ventana, ahora)
      .run();

    return { permitido: true, restantes: maximo - 1 };
  }

  if (Number(fila.contador) >= maximo) return { permitido: false, restantes: 0 };

  await env.DB.prepare(`UPDATE rate_limit SET contador = contador + 1, actualizado_en = ? WHERE clave = ?`)
    .bind(ahora, clave)
    .run();

  return { permitido: true, restantes: maximo - Number(fila.contador) - 1 };
}

async function resolverActivo(env, log, cache) {
  const host = typeof log.host === 'string' ? log.host.trim() : '';
  const destino = typeof log.destino_ip === 'string' ? log.destino_ip.trim() : '';
  if (!host && !destino) return null;

  const clave = `${host.toLowerCase()}|${destino}`;
  if (cache.has(clave)) return cache.get(clave);

  let activo = null;

  if (host) {
    activo = await env.DB.prepare(
      `SELECT * FROM activos WHERE activo = 1 AND lower(hostname) = lower(?) LIMIT 1`
    )
      .bind(host)
      .first();
  }

  if (!activo && destino) {
    activo = await env.DB.prepare(`SELECT * FROM activos WHERE activo = 1 AND ip = ? LIMIT 1`)
      .bind(destino)
      .first();
  }

  cache.set(clave, activo);
  return activo;
}

async function resolverUsuario(env, username, cache) {
  if (!username) return null;

  const clave = String(username).toLowerCase();
  if (cache.has(clave)) return cache.get(clave);

  const fila = await env.DB.prepare(
    `SELECT username, nombre, rol, area, email FROM usuarios_negocio WHERE lower(username) = lower(?) LIMIT 1`
  )
    .bind(username)
    .first();

  cache.set(clave, fila);
  return fila;
}

function construirEvidencia(log) {
  const evidencia = {
    host: log.host ?? null,
    destino_ip: log.destino_ip ?? null,
    ip_origen: log.ip_origen ?? log.ip ?? null,
    usuario: log.usuario ?? null,
    intentos: log.intentos ?? null,
    payload: typeof log.payload === 'string' ? log.payload.slice(0, 300) : null,
  };

  return JSON.stringify(evidencia).slice(0, 500);
}

function nuevaFilaLog(log, resultado, activoId, timestamp, tenantId) {
  return {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    timestamp,
    fuente: log.fuente,
    tipo_evento: log.tipo_evento,
    ip_origen: log.ip_origen || log.ip || null,
    destino_ip: log.destino_ip || null,
    host: log.host || null,
    usuario: log.usuario || null,
    activo_id: activoId || null,
    resultado,
    payload_json: JSON.stringify(log).slice(0, 2000),
  };
}

async function manejarStream(request, env, contexto) {
  const tenantId = contexto.tenantId;

  const limite = await consumirLimite(env, contexto.rateKey, MAX_STREAM_POR_MINUTO, 60 * 1000);
  if (!limite.permitido) {
    return error(429, 'Demasiadas peticiones. Esperá un minuto antes de reintentar.', 'DEMASIADAS_PETICIONES');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'El cuerpo de la petición debe ser JSON válido', 'JSON_INVALIDO');
  }

  if (!body || !Array.isArray(body.logs)) {
    return error(400, 'Se esperaba un cuerpo con la forma { "logs": [ ... ] }', 'VALIDACION');
  }
  if (body.logs.length === 0) {
    return error(400, 'El lote de logs está vacío', 'VALIDACION');
  }
  if (body.logs.length > MAX_LOGS_POR_LOTE) {
    return error(400, `Máximo ${MAX_LOGS_POR_LOTE} logs por lote`, 'VALIDACION');
  }

  for (let i = 0; i < body.logs.length; i++) {
    const problema = validarLog(body.logs[i], i);
    if (problema) return error(400, problema, 'VALIDACION');
  }

  const ventanaDesde = new Date(Date.now() - VENTANA_DETECCION_MS).toISOString();

  // Cuenta previa en la ventana de 60 s, agrupada por usuario e IP en una sola consulta.
  const usuariosVentana = new Set();
  const ipsVentana = new Set();

  for (const log of body.logs) {
    if (log.fuente === 'identidad' && log.tipo_evento === 'login_fallido') {
      usuariosVentana.add(String(log.usuario || '').trim().toLowerCase());
    }
    if (log.fuente === 'red' && log.tipo_evento === 'request_normal') {
      ipsVentana.add(String(log.ip_origen || log.ip || '').trim());
    }
  }
  usuariosVentana.delete('');
  ipsVentana.delete('');

  const previosPorUsuario = new Map();
  if (usuariosVentana.size > 0) {
    const lista = [...usuariosVentana];
    const marcas = lista.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT lower(usuario) AS clave, COUNT(*) AS total
         FROM logs
        WHERE tenant_id = ? AND fuente = 'identidad' AND tipo_evento = 'login_fallido'
          AND timestamp >= ? AND lower(usuario) IN (${marcas})
        GROUP BY lower(usuario)`
    )
      .bind(tenantId, ventanaDesde, ...lista)
      .all();

    for (const fila of results) previosPorUsuario.set(fila.clave, Number(fila.total) || 0);
  }

  const previosPorIp = new Map();
  if (ipsVentana.size > 0) {
    const lista = [...ipsVentana];
    const marcas = lista.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT ip_origen AS clave, COUNT(*) AS total
         FROM logs
        WHERE tenant_id = ? AND fuente = 'red' AND tipo_evento = 'request_normal'
          AND timestamp >= ? AND ip_origen IN (${marcas})
        GROUP BY ip_origen`
    )
      .bind(tenantId, ventanaDesde, ...lista)
      .all();

    for (const fila of results) previosPorIp.set(fila.clave, Number(fila.total) || 0);
  }

  const lotePorUsuario = new Map();
  const lotePorIp = new Map();

  const contadores = new Map(
    Object.values(AGENTE_POR_FUENTE).map((agente) => [agente, { procesados: 0, bloqueados: 0, escalados: 0 }])
  );
  const casos = [];
  const casosPorClave = new Map();
  const cacheActivos = new Map();
  const cacheUsuarios = new Map();
  const filasLog = [];
  const creadoEn = new Date().toISOString();
  let descartados = 0;
  let observados = 0;
  let bloqueados = 0;
  let duplicados = 0;
  let iaUsadas = 0;

  for (const log of body.logs) {
    const agente = AGENTE_POR_FUENTE[log.fuente];
    const contador = contadores.get(agente);
    contador.procesados++;

    const deteccion = evaluarEvento(log);

    if (!deteccion) {
      let resultado = 'descartado';

      // Auto-bloqueo de red: más de 100 requests del mismo origen en 60 s.
      if (log.fuente === 'red' && log.tipo_evento === 'request_normal') {
        const ip = String(log.ip_origen || log.ip || '').trim();
        if (ip) {
          const lote = (lotePorIp.get(ip) || 0) + 1;
          lotePorIp.set(ip, lote);
          if (superaUmbral(previosPorIp.get(ip) || 0, lote, UMBRAL_AUTO_BLOQUEO)) {
            resultado = 'bloqueado';
          }
        }
      }

      contador.bloqueados++;
      if (resultado === 'bloqueado') bloqueados++;
      else descartados++;

      filasLog.push(nuevaFilaLog(log, resultado, null, creadoEn, tenantId));
      continue;
    }

    // Fuerza bruta: el sexto fallo del mismo usuario en 60 s dispara el caso.
    if (log.fuente === 'identidad' && log.tipo_evento === 'login_fallido') {
      const usuario = String(log.usuario || '').trim().toLowerCase();
      const lote = (lotePorUsuario.get(usuario) || 0) + 1;
      lotePorUsuario.set(usuario, lote);

      if (!superaUmbral(previosPorUsuario.get(usuario) || 0, lote, UMBRAL_FUERZA_BRUTA)) {
        contador.bloqueados++;
        observados++;
        filasLog.push(nuevaFilaLog(log, 'observado', null, creadoEn, tenantId));
        continue;
      }
    }

    contador.escalados++;
    const clave = claveDedupe(log);

    // Duplicado dentro del mismo lote: se acumula sin crear otro caso.
    const enLote = casosPorClave.get(clave);
    if (enLote) {
      enLote.ocurrencias += 1;
      duplicados++;
      filasLog.push(nuevaFilaLog(log, 'duplicado', null, creadoEn, tenantId));
      continue;
    }

    // Duplicado de un caso activo reciente: se acumula en la ocurrencia existente.
    const previo = await env.DB.prepare(
      `SELECT id FROM casos
        WHERE tenant_id = ? AND clave_dedupe = ? AND estado IN ${ESTADOS_ACTIVOS}
          AND COALESCE(ultima_ocurrencia, creado_en) >= ?
        LIMIT 1`
    )
      .bind(tenantId, clave, new Date(Date.now() - COOLDOWN_DEDUPE_MS).toISOString())
      .first();

    if (previo) {
      await env.DB.prepare(
        `UPDATE casos SET ocurrencias = ocurrencias + 1, ultima_ocurrencia = ? WHERE id = ?`
      )
        .bind(creadoEn, previo.id)
        .run();

      duplicados++;
      filasLog.push(nuevaFilaLog(log, 'duplicado', null, creadoEn, tenantId));
      continue;
    }

    const activo = await resolverActivo(env, log, cacheActivos);
    const perfil = await resolverUsuario(env, log.usuario, cacheUsuarios);
    const usuarioTexto = perfil
      ? `${perfil.nombre} (${perfil.rol || perfil.area || 'usuario'})`
      : log.usuario || 'no informado';
    const areaUsuario = perfil?.area ? `, área ${perfil.area}` : '';

    const contexto = activo
      ? `Activo ${activo.hostname} (${activo.tipo}, área ${activo.departamento}, servicio ${activo.servicio}, criticidad ${activo.criticidad}, SO ${activo.sistema_operativo}). ` +
        `Usuario afectado: ${usuarioTexto}${areaUsuario}. Origen: ${log.ip_origen || log.ip || 'desconocido'}.`
      : `Activo no identificado. Usuario afectado: ${usuarioTexto}${areaUsuario}. ` +
        `Origen: ${log.ip_origen || log.ip || 'desconocido'}.`;

    let resumen;
    let recomendacion;
    let fuente;

    // Tope de inferencias por lote para no agotar la cuota ni colgar el request.
    if (iaUsadas < MAX_IA_POR_LOTE) {
      iaUsadas += 1;
      ({ resumen, recomendacion, fuente } = await generarResumenIA(env, {
        titulo: deteccion.titulo,
        agente,
        severidad: deteccion.severidad,
        log,
        contexto,
      }));
    } else {
      resumen = `${deteccion.titulo} detectado por el Agente ${agente}. Requiere revisión manual.`;
      recomendacion = 'Aislar el activo afectado y revisar los logs.';
      fuente = 'fallback';
    }

    const caso = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      titulo: deteccion.titulo,
      severidad: deteccion.severidad,
      agente: `Agente ${agente}`,
      resumen,
      recomendacion,
      creado_en: creadoEn,
      clave_dedupe: clave,
      ocurrencias: 1,
      ultima_ocurrencia: creadoEn,
      resumen_fuente: fuente,
      activo_id: activo?.id ?? null,
      tipo_evento: log.tipo_evento,
      ip_origen: log.ip_origen || log.ip || null,
      usuario_afectado: log.usuario || null,
      evidencia_json: construirEvidencia(log),
    };

    casos.push(caso);
    casosPorClave.set(clave, caso);
    filasLog.push(nuevaFilaLog(log, 'escalado', activo?.id ?? null, creadoEn, tenantId));
  }

  // Asegura las filas de agentes y aplica el delta acumulado en una sola transacción.
  const sentencias = Object.values(AGENTE_POR_FUENTE).map((agente) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO agentes_estado (id, tenant_id, nombre, logs_procesados, logs_bloqueados, casos_escalados, estado)
       VALUES (?, ?, ?, 0, 0, 0, 'activo')`
    ).bind(`agente-${tenantId}-${agente.toLowerCase()}`, tenantId, agente)
  );

  for (const [agente, contador] of contadores) {
    sentencias.push(
      env.DB.prepare(
        `UPDATE agentes_estado
            SET logs_procesados = logs_procesados + ?,
                logs_bloqueados = logs_bloqueados + ?,
                casos_escalados = casos_escalados + ?
          WHERE tenant_id = ? AND nombre = ?`
      ).bind(contador.procesados, contador.bloqueados, contador.escalados, tenantId, agente)
    );
  }

  for (const fila of filasLog) {
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO logs (id, tenant_id, timestamp, fuente, tipo_evento, ip_origen, destino_ip, host, usuario,
                           activo_id, resultado, payload_json, procesado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        fila.id,
        fila.tenant_id,
        fila.timestamp,
        fila.fuente,
        fila.tipo_evento,
        fila.ip_origen,
        fila.destino_ip,
        fila.host,
        fila.usuario,
        fila.activo_id,
        fila.resultado,
        fila.payload_json
      )
    );
  }

  for (let i = 0; i < sentencias.length; i += MAX_SENTENCIAS_POR_BATCH) {
    await env.DB.batch(sentencias.slice(i, i + MAX_SENTENCIAS_POR_BATCH));
  }

  await insertarCasos(env, casos);
  await recalcularSalud(env, tenantId, body.logs.length);

  // Retención: borra logs de más de 24 h en una fracción de los requests.
  if (Math.random() < 0.05) {
    await env.DB.prepare(
      `DELETE FROM logs WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`
    ).run();
  }

  const data = {
    procesados: body.logs.length,
    escalados: body.logs.length - descartados - observados - bloqueados,
    descartados,
    observados,
    bloqueados,
    casos_creados: casos.length,
    duplicados,
  };

  if (contexto.token) {
    await registrarAuditoria(env, {
      tenantId,
      email: `token:${contexto.token.nombre}`,
      rol: 'simulador',
      accion: 'simulacion',
      detalle: { token: contexto.token.nombre, ...data },
      request,
    });
  }

  return json({ ok: true, data });
}

const FUENTES_VALIDAS = new Set(Object.keys(AGENTE_POR_FUENTE));
const RESULTADOS_VALIDOS = new Set(RESULTADOS);
const COLUMNAS_LOGS =
  'rowid AS seq, timestamp, fuente, tipo_evento, host, destino_ip, ip_origen, usuario, resultado, activo_id';

async function manejarLogs(env, url, tenantId) {
  const params = url.searchParams;
  const fuente = (params.get('fuente') || '').trim();
  const resultado = (params.get('resultado') || '').trim();
  const host = (params.get('host') || '').trim().slice(0, 120);
  const usuario = (params.get('usuario') || '').trim().slice(0, 120);
  const q = (params.get('q') || '').trim().slice(0, 120);
  const desde = (params.get('desde') || '').trim().slice(0, 40);
  const hasta = (params.get('hasta') || '').trim().slice(0, 40);
  const sentido = params.get('sentido') === 'desc' ? 'desc' : 'asc';
  const esCsv = params.get('format') === 'csv';

  if (fuente && !FUENTES_VALIDAS.has(fuente)) {
    return error(400, 'fuente inválida', 'VALIDACION');
  }
  if (resultado && !RESULTADOS_VALIDOS.has(resultado)) {
    return error(400, 'resultado inválido', 'VALIDACION');
  }

  const after = Math.max(0, Math.floor(Number(params.get('after')) || 0));
  const before = Math.max(0, Math.floor(Number(params.get('before')) || 0));
  const limitRaw = Number(params.get('limit'));
  const limite = esCsv
    ? 1000
    : Math.min(100, Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50));

  const condiciones = [];
  const valores = [];

  condiciones.push('tenant_id = ?');
  valores.push(tenantId);

  if (fuente) {
    condiciones.push('fuente = ?');
    valores.push(fuente);
  }
  if (resultado) {
    condiciones.push('resultado = ?');
    valores.push(resultado);
  }
  if (host) {
    condiciones.push('lower(host) LIKE ?');
    valores.push(`%${host.toLowerCase()}%`);
  }
  if (usuario) {
    condiciones.push('lower(usuario) LIKE ?');
    valores.push(`%${usuario.toLowerCase()}%`);
  }
  if (q) {
    const patron = `%${q.toLowerCase()}%`;
    condiciones.push(
      '(lower(tipo_evento) LIKE ? OR lower(host) LIKE ? OR lower(usuario) LIKE ? OR lower(ip_origen) LIKE ? OR lower(destino_ip) LIKE ?)'
    );
    valores.push(patron, patron, patron, patron, patron);
  }
  if (desde) {
    condiciones.push('timestamp >= ?');
    valores.push(desde);
  }
  if (hasta) {
    condiciones.push('timestamp <= ?');
    valores.push(hasta);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  if (esCsv) {
    const { results } = await env.DB.prepare(
      `SELECT ${COLUMNAS_LOGS} FROM logs ${where} ORDER BY rowid DESC LIMIT ?`
    )
      .bind(...valores, 1000)
      .all();

    const cabecera = [
      'seq',
      'timestamp',
      'fuente',
      'tipo_evento',
      'host',
      'destino_ip',
      'ip_origen',
      'usuario',
      'resultado',
      'activo_id',
    ];
    const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
    const lineas = [
      cabecera.join(','),
      ...results.map((fila) => cabecera.map((columna) => escapar(fila[columna])).join(',')),
    ];

    return new Response(lineas.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="soc-ia-logs.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }

  let consulta;

  if (sentido === 'desc') {
    if (before > 0) {
      condiciones.push('rowid < ?');
      valores.push(before);
    }
    consulta = `SELECT ${COLUMNAS_LOGS} FROM logs ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''} ORDER BY rowid DESC LIMIT ?`;
    valores.push(limite);
  } else if (after > 0) {
    condiciones.push('rowid > ?');
    valores.push(after);
    consulta = `SELECT ${COLUMNAS_LOGS} FROM logs ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''} ORDER BY rowid ASC LIMIT ?`;
    valores.push(limite);
  } else {
    consulta = `SELECT * FROM (SELECT ${COLUMNAS_LOGS} FROM logs ${where} ORDER BY rowid DESC LIMIT ?) ORDER BY seq ASC`;
    valores.push(limite);
  }

  const { results } = await env.DB.prepare(consulta).bind(...valores).all();
  const logs = results.map((fila) => ({ ...fila, seq: Number(fila.seq) }));
  const seqs = logs.map((fila) => fila.seq);

  return json({
    ok: true,
    data: {
      logs,
      siguiente: seqs.length ? Math.max(...seqs) : after,
      anterior: sentido === 'desc' && logs.length === limite ? Math.min(...seqs) : null,
      total: logs.length,
    },
  });
}

async function manejarResetDemo(request, env, usuario) {
  const tenantId = usuario.tenant_id;
  const borrado = await env.DB.prepare(`DELETE FROM casos WHERE tenant_id = ?`).bind(tenantId).run();
  const ahora = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE agentes_estado
          SET logs_procesados = 0, logs_bloqueados = 0, casos_escalados = 0, estado = 'activo'
        WHERE tenant_id = ?`
    ).bind(tenantId),
    env.DB.prepare(
      `UPDATE sistema_salud
          SET salud_porcentaje = 100, amenazas_activas = 0, logs_por_segundo = 0, actualizado_en = ?
        WHERE tenant_id = ?`
    ).bind(ahora, tenantId),
    env.DB.prepare(`DELETE FROM intentos_login`),
    env.DB.prepare(`DELETE FROM rate_limit`),
    env.DB.prepare(`DELETE FROM logs WHERE tenant_id = ?`).bind(tenantId),
  ]);

  await registrarAuditoria(env, {
    tenantId,
    usuarioId: usuario.id,
    email: usuario.email,
    rol: usuario.rol,
    accion: 'reset',
    detalle: { casos_eliminados: borrado.meta?.changes ?? 0 },
    request,
  });

  return json({
    ok: true,
    data: { casos_eliminados: borrado.meta?.changes ?? 0, salud_sistema: 100 },
  });
}

async function manejarDashboard(env, tenantId) {
  const { results: filasCasos } = await env.DB.prepare(
    `SELECT c.*,
            a.hostname AS activo_hostname,
            a.ip AS activo_ip,
            a.tipo AS activo_tipo,
            a.departamento AS activo_departamento,
            a.responsable AS activo_responsable,
            a.servicio AS activo_servicio,
            a.criticidad AS activo_criticidad,
            a.sistema_operativo AS activo_so,
            un.nombre AS usuario_nombre,
            un.rol AS usuario_rol,
            un.area AS usuario_area,
            un.email AS usuario_email
       FROM casos c
       LEFT JOIN activos a ON a.id = c.activo_id
       LEFT JOIN usuarios_negocio un ON un.tenant_id = c.tenant_id AND lower(un.username) = lower(c.usuario_afectado)
      WHERE c.tenant_id = ? AND c.estado IN ${ESTADOS_ACTIVOS}
      ORDER BY c.creado_en DESC
      LIMIT 100`
  )
    .bind(tenantId)
    .all();

  const casos = filasCasos.map((fila) => {
    const {
      activo_hostname,
      activo_ip,
      activo_tipo,
      activo_departamento,
      activo_responsable,
      activo_servicio,
      activo_criticidad,
      activo_so,
      usuario_nombre,
      usuario_rol,
      usuario_area,
      usuario_email,
      ...caso
    } = fila;

    const activo = activo_hostname
      ? {
          id: caso.activo_id,
          hostname: activo_hostname,
          ip: activo_ip,
          tipo: activo_tipo,
          departamento: activo_departamento,
          responsable: activo_responsable,
          servicio: activo_servicio,
          criticidad: activo_criticidad,
          sistema_operativo: activo_so,
        }
      : null;

    const usuario_perfil = usuario_nombre
      ? {
          username: caso.usuario_afectado,
          nombre: usuario_nombre,
          rol: usuario_rol,
          area: usuario_area,
          email: usuario_email,
        }
      : null;

    return {
      ...caso,
      activo,
      usuario_perfil,
      prioridad: calcularPrioridad(caso.severidad, activo?.criticidad ?? CRITICIDAD_POR_DEFECTO),
    };
  });

  const { results: agentes } = await env.DB.prepare(
    `SELECT * FROM agentes_estado WHERE tenant_id = ? ORDER BY nombre`
  )
    .bind(tenantId)
    .all();
  const salud = await env.DB.prepare(
    `SELECT salud_porcentaje FROM sistema_salud WHERE tenant_id = ?`
  )
    .bind(tenantId)
    .first();

  // Métricas derivadas de la tabla `casos`: única fuente de verdad para no descuadrar
  // los contadores con la cola de casos activos.
  const { results: porAgente } = await env.DB.prepare(
    `SELECT agente_responsable,
            COUNT(*) AS escalados,
            SUM(CASE WHEN estado IN ('contenido', 'falso_positivo') THEN 1 ELSE 0 END) AS atendidos,
            SUM(CASE WHEN estado IN ${ESTADOS_ACTIVOS} THEN 1 ELSE 0 END) AS activos
       FROM casos
      WHERE tenant_id = ?
      GROUP BY agente_responsable`
  )
    .bind(tenantId)
    .all();

  const { results: porTipo } = await env.DB.prepare(
    `SELECT titulo, COUNT(*) AS total FROM casos WHERE tenant_id = ? GROUP BY titulo ORDER BY total DESC`
  )
    .bind(tenantId)
    .all();

  const metricasPorAgente = Object.values(AGENTE_POR_FUENTE).map((nombre) => {
    const fila = porAgente.find((item) => item.agente_responsable === `Agente ${nombre}`) ?? {};
    return {
      nombre,
      escalados: Number(fila.escalados) || 0,
      atendidos: Number(fila.atendidos) || 0,
      activos: Number(fila.activos) || 0,
    };
  });

  return json({
    ok: true,
    data: {
      salud_sistema: salud ? salud.salud_porcentaje : await recalcularSalud(env, tenantId),
      casos_activos: casos,
      agentes,
      metricas: {
        ataques_por_tipo: porTipo.map((fila) => ({ titulo: fila.titulo, total: Number(fila.total) || 0 })),
        agentes: metricasPorAgente,
      },
    },
  });
}

async function manejarResolucionCaso(request, env, id, usuario) {
  const tenantId = usuario.tenant_id;
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'El cuerpo de la petición debe ser JSON válido', 'JSON_INVALIDO');
  }

  const nuevoEstado = body?.estado;
  if (!ESTADOS_RESOLUCION.includes(nuevoEstado)) {
    return error(
      400,
      `Estado inválido. Valores permitidos: ${ESTADOS_RESOLUCION.join(', ')}`,
      'VALIDACION'
    );
  }

  const resultado = await env.DB.prepare(
    `UPDATE casos SET estado = ?, resuelto_en = ? WHERE id = ? AND tenant_id = ?`
  )
    .bind(nuevoEstado, new Date().toISOString(), id, tenantId)
    .run();

  if (!resultado.meta || resultado.meta.changes === 0) {
    return error(404, `No existe un caso con id "${id}"`, 'NO_ENCONTRADO');
  }

  const salud = await recalcularSalud(env, tenantId);

  await registrarAuditoria(env, {
    tenantId,
    usuarioId: usuario.id,
    email: usuario.email,
    rol: usuario.rol,
    accion: 'triage',
    detalle: { caso: id, estado: nuevoEstado },
    request,
  });

  return json({ ok: true, data: { nuevo_estado: nuevoEstado, salud_sistema: salud } });
}

// ---------- Auditoría ----------

async function manejarAuditoria(env, url, tenantId) {
  const limiteRaw = Number(url.searchParams.get('limit'));
  const limite = Math.min(200, Math.max(1, Number.isFinite(limiteRaw) && limiteRaw > 0 ? Math.floor(limiteRaw) : 100));
  const accion = (url.searchParams.get('accion') || '').trim().slice(0, 40);

  const condiciones = ['tenant_id = ?'];
  const valores = [tenantId];

  if (accion) {
    condiciones.push('accion = ?');
    valores.push(accion);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, usuario_email, rol, accion, detalle_json, ip, creado_en
       FROM auditoria
      WHERE ${condiciones.join(' AND ')}
      ORDER BY creado_en DESC
      LIMIT ?`
  )
    .bind(...valores, limite)
    .all();

  const auditoria = results.map(({ detalle_json, ...fila }) => {
    let detalle = null;
    if (detalle_json) {
      try {
        detalle = JSON.parse(detalle_json);
      } catch {
        detalle = null;
      }
    }
    return { ...fila, detalle };
  });

  return json({ ok: true, data: { auditoria } });
}

// ---------- Tokens de simulación ----------

const CORS_SIMULACION = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function conCorsSimulacion(response) {
  const headers = new Headers(response.headers);
  for (const [clave, valor] of Object.entries(CORS_SIMULACION)) headers.set(clave, valor);
  return new Response(response.body, { status: response.status, headers });
}

async function hashSha256(texto) {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function tokenAleatorio() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return `socsim_${btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

async function manejarCrearToken(request, env, usuario) {
  if (usuario.rol !== 'admin') {
    return error(403, 'Esta acción requiere rol admin', 'PROHIBIDO');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'El cuerpo debe ser JSON válido', 'JSON_INVALIDO');
  }

  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim().slice(0, 60) : '';
  if (!nombre) return error(400, 'El nombre del token es obligatorio', 'VALIDACION');

  const token = tokenAleatorio();
  const id = crypto.randomUUID();
  const ahora = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO tokens_simulacion (id, tenant_id, nombre, hash, activo, creado_por, creado_en)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(id, usuario.tenant_id, nombre, await hashSha256(token), usuario.email, ahora)
    .run();

  await registrarAuditoria(env, {
    tenantId: usuario.tenant_id,
    usuarioId: usuario.id,
    email: usuario.email,
    rol: usuario.rol,
    accion: 'token_creado',
    detalle: { tokenId: id, nombre },
    request,
  });

  return json({ ok: true, data: { id, nombre, token } });
}

async function manejarListarTokens(env, usuario) {
  if (usuario.rol !== 'admin') {
    return error(403, 'Esta acción requiere rol admin', 'PROHIBIDO');
  }

  const { results } = await env.DB.prepare(
    `SELECT id, nombre, activo, creado_por, creado_en, ultimo_uso
       FROM tokens_simulacion
      WHERE tenant_id = ?
      ORDER BY creado_en DESC`
  )
    .bind(usuario.tenant_id)
    .all();

  return json({ ok: true, data: { tokens: results } });
}

async function manejarRevocarToken(request, env, usuario, id) {
  if (usuario.rol !== 'admin') {
    return error(403, 'Esta acción requiere rol admin', 'PROHIBIDO');
  }

  const resultado = await env.DB.prepare(
    `UPDATE tokens_simulacion SET activo = 0 WHERE id = ? AND tenant_id = ?`
  )
    .bind(id, usuario.tenant_id)
    .run();

  if (!resultado.meta || resultado.meta.changes === 0) {
    return error(404, 'Token no encontrado', 'NO_ENCONTRADO');
  }

  await registrarAuditoria(env, {
    tenantId: usuario.tenant_id,
    usuarioId: usuario.id,
    email: usuario.email,
    rol: usuario.rol,
    accion: 'token_revocado',
    detalle: { tokenId: id },
    request,
  });

  return json({ ok: true, data: { revocado: true } });
}

async function manejarSimulacion(request, env) {
  const cabecera = request.headers.get('Authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';

  if (!token) {
    return conCorsSimulacion(error(401, 'Falta el token de simulación', 'TOKEN_INVALIDO'));
  }

  const hash = await hashSha256(token);
  const fila = await env.DB.prepare(
    `SELECT id, nombre, tenant_id FROM tokens_simulacion WHERE hash = ? AND activo = 1`
  )
    .bind(hash)
    .first();

  if (!fila) {
    return conCorsSimulacion(error(401, 'Token inválido o revocado', 'TOKEN_INVALIDO'));
  }

  await env.DB.prepare(`UPDATE tokens_simulacion SET ultimo_uso = ? WHERE id = ?`)
    .bind(new Date().toISOString(), fila.id)
    .run();

  const respuesta = await manejarStream(request, env, {
    tenantId: fila.tenant_id,
    rateKey: `simulate|${fila.id}`,
    token: { id: fila.id, nombre: fila.nombre },
  });

  return conCorsSimulacion(respuesta);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Con `run_worker_first: ["/api/*"]` solo las rutas de API llegan al Worker.
    // Este fallback cubre el desarrollo local y rutas no-API directas.
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);

      const aceptaHtml = (request.headers.get('Accept') || '').includes('text/html');
      if (aceptaHtml) {
        return new Response(paginaNoEncontrada(url.pathname), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return error(404, `Ruta no encontrada: ${method} ${url.pathname}`, 'NO_ENCONTRADO');
    }

    try {
      // Público: health check y login.
      if (url.pathname === '/api/health' && method === 'GET') {
        return json({
          ok: true,
          data: {
            status: 'SOC-IA Worker Operativo',
            database: env.DB ? 'D1 Conectada' : 'D1 No conectada',
          },
        });
      }

      if (url.pathname === '/api/auth/login' && method === 'POST') {
        return await manejarLogin(request, env, json, error);
      }

      // Simulación máquina-a-máquina con token (para la consola de ataque).
      if (url.pathname === '/api/simulate' && method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_SIMULACION });
      }
      if (url.pathname === '/api/simulate' && method === 'POST') {
        return await manejarSimulacion(request, env);
      }

      // Todo lo demás exige sesión.
      const usuario = await usuarioDesdeRequest(request, env);
      if (!usuario) return error(401, 'Sesión requerida', 'NO_AUTENTICADO');

      // CSRF: en métodos mutantes el Origin debe coincidir con el host.
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        const origen = request.headers.get('Origin');
        if (origen) {
          let hostOrigen = null;
          try {
            hostOrigen = new URL(origen).host;
          } catch {
            hostOrigen = null;
          }
          if (hostOrigen !== url.host) return error(403, 'Origen no permitido', 'ORIGEN_INVALIDO');
        }
      }

      if (url.pathname === '/api/auth/me' && method === 'GET') {
        const { sesionId, ...publico } = usuario;
        return json({ ok: true, data: { usuario: publico } });
      }

      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        return await manejarLogout(request, env, json, usuario);
      }

      if (url.pathname === '/api/auditoria' && method === 'GET') {
        if (usuario.rol !== 'admin') {
          return error(403, 'Esta acción requiere rol admin', 'PROHIBIDO');
        }
        return await manejarAuditoria(env, url, usuario.tenant_id);
      }

      if (url.pathname === '/api/admin/tokens' && method === 'POST') {
        return await manejarCrearToken(request, env, usuario);
      }

      if (url.pathname === '/api/admin/tokens' && method === 'GET') {
        return await manejarListarTokens(env, usuario);
      }

      if (url.pathname.startsWith('/api/admin/tokens/') && method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.slice('/api/admin/tokens/'.length));
        if (!id) return error(400, 'Falta el id del token', 'VALIDACION');
        return await manejarRevocarToken(request, env, usuario, id);
      }

      if (url.pathname === '/api/stream' && method === 'POST') {
        return await manejarStream(request, env, {
          tenantId: usuario.tenant_id,
          rateKey: `stream|${usuario.id}`,
        });
      }

      if (url.pathname === '/api/demo/reset' && method === 'POST') {
        if (usuario.rol !== 'admin') {
          return error(403, 'Esta acción requiere rol admin', 'PROHIBIDO');
        }
        return await manejarResetDemo(request, env, usuario);
      }

      if (url.pathname === '/api/dashboard' && method === 'GET') {
        return await manejarDashboard(env, usuario.tenant_id);
      }

      if (url.pathname === '/api/logs' && method === 'GET') {
        return await manejarLogs(env, url, usuario.tenant_id);
      }

      if (url.pathname.startsWith('/api/cases/') && method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.slice('/api/cases/'.length));
        if (!id) return error(400, 'Falta el id del caso en la ruta', 'VALIDACION');

        const limite = await consumirLimite(env, `patch|${usuario.id}`, MAX_PATCH_POR_MINUTO, 60 * 1000);
        if (!limite.permitido) {
          return error(429, 'Demasiadas peticiones. Esperá un minuto antes de reintentar.', 'DEMASIADAS_PETICIONES');
        }

        return await manejarResolucionCaso(request, env, id, usuario);
      }

      return error(404, `Ruta no encontrada: ${method} ${url.pathname}`, 'NO_ENCONTRADO');
    } catch (fallo) {
      // Log operativo, sin payload ni datos personales.
      console.warn(`[SOC-IA] Error no controlado en ${method} ${url.pathname}: ${fallo.message}`);
      return error(500, 'Error interno del Worker', 'ERROR_INTERNO');
    }
  },
};
