const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const AGENTE_POR_FUENTE = {
  red: 'Red',
  identidad: 'Identidad',
  endpoint: 'Endpoint',
};

// Reglas deterministas del SPEC (sección 4).
const REGLAS = {
  'red:escaneo_puertos': {
    severidad: 'alta',
    titulo: 'Escaneo de puertos detectado',
  },
  'identidad:login_fallido': {
    severidad: 'alta',
    titulo: 'Posible ataque de fuerza bruta',
    condicion: (log) => Number(log.intentos) > 5,
  },
  'endpoint:powershell_encoded': {
    severidad: 'critica',
    titulo: 'Ejecución de PowerShell ofuscado',
  },
};

const ESTADOS_RESOLUCION = ['contenido', 'falso_positivo'];
const ESTADOS_ACTIVOS = "('escalado', 'en_triaje')";
const MAX_LOGS_POR_LOTE = 100;
const MAX_SENTENCIAS_POR_BATCH = 50;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
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
  return null;
}

function evaluarLog(log) {
  const regla = REGLAS[`${log.fuente}:${log.tipo_evento}`];
  if (!regla) return null;
  if (regla.condicion && !regla.condicion(log)) return null;

  return {
    agente: AGENTE_POR_FUENTE[log.fuente],
    severidad: regla.severidad,
    titulo: regla.titulo,
  };
}

async function generarResumenIA(env, { titulo, agente, severidad, log }) {
  const fallback = {
    resumen: `${titulo} detectado por el Agente ${agente}. Requiere revisión manual.`,
    recomendacion: 'Aislar el activo afectado y revisar los logs.',
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
          content: `Evento: ${titulo} (severidad ${severidad}) detectado por el Agente ${agente}. Datos: ${JSON.stringify(log)}`,
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
    };
  } catch (aiError) {
    // Observabilidad sin payload ni PII: solo el motivo del fallback.
    console.warn(`[SOC-IA] Workers AI no disponible, se usa resumen de respaldo: ${aiError.message}`);
    return fallback;
  }
}

async function recalcularSalud(env, logsPorSegundo = null) {
  const { results } = await env.DB.prepare(
    `SELECT severidad, COUNT(*) AS total FROM casos WHERE estado IN ${ESTADOS_ACTIVOS} GROUP BY severidad`
  ).all();

  const totales = Object.fromEntries(results.map((fila) => [fila.severidad, fila.total]));
  const criticos = totales.critica ?? 0;
  const altos = totales.alta ?? 0;
  const amenazas = criticos + altos + (totales.media ?? 0) + (totales.baja ?? 0);
  const salud = Math.max(0, Math.min(100, 100 - criticos * 20 - altos * 10));
  const ahora = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO sistema_salud (id, salud_porcentaje, amenazas_activas, logs_por_segundo, actualizado_en)
       VALUES (1, 100, 0, 0, ?)`
    ).bind(ahora),
    env.DB.prepare(
      `UPDATE sistema_salud
          SET salud_porcentaje = ?, amenazas_activas = ?, logs_por_segundo = COALESCE(?, logs_por_segundo), actualizado_en = ?
        WHERE id = 1`
    ).bind(salud, amenazas, logsPorSegundo, ahora),
    env.DB.prepare(
      `UPDATE agentes_estado
          SET estado = CASE
            WHEN nombre IN (
              SELECT REPLACE(agente_responsable, 'Agente ', '') FROM casos WHERE estado IN ${ESTADOS_ACTIVOS}
            ) THEN 'alerta'
            ELSE 'activo'
          END`
    ),
  ]);

  return salud;
}

async function insertarCasos(env, casos) {
  const sentencias = casos.map((caso) =>
    env.DB.prepare(
      `INSERT INTO casos (id, titulo, severidad, agente_responsable, resumen_ia, recomendacion_ia, estado, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'escalado', ?)`
    ).bind(caso.id, caso.titulo, caso.severidad, caso.agente, caso.resumen, caso.recomendacion, caso.creado_en)
  );

  for (let i = 0; i < sentencias.length; i += MAX_SENTENCIAS_POR_BATCH) {
    await env.DB.batch(sentencias.slice(i, i + MAX_SENTENCIAS_POR_BATCH));
  }
}

async function manejarStream(request, env) {
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

  const contadores = new Map(
    Object.values(AGENTE_POR_FUENTE).map((agente) => [agente, { procesados: 0, bloqueados: 0, escalados: 0 }])
  );
  const casos = [];
  const creadoEn = new Date().toISOString();

  for (const log of body.logs) {
    const agente = AGENTE_POR_FUENTE[log.fuente];
    const contador = contadores.get(agente);
    contador.procesados++;

    const deteccion = evaluarLog(log);
    if (!deteccion) {
      contador.bloqueados++;
      continue;
    }

    contador.escalados++;
    const { resumen, recomendacion } = await generarResumenIA(env, {
      titulo: deteccion.titulo,
      agente,
      severidad: deteccion.severidad,
      log,
    });

    casos.push({
      id: crypto.randomUUID(),
      titulo: deteccion.titulo,
      severidad: deteccion.severidad,
      agente: `Agente ${agente}`,
      resumen,
      recomendacion,
      creado_en: creadoEn,
    });
  }

  // Asegura las filas de agentes y aplica el delta acumulado en una sola transacción.
  const sentencias = Object.values(AGENTE_POR_FUENTE).map((agente) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO agentes_estado (id, nombre, logs_procesados, logs_bloqueados, casos_escalados, estado)
       VALUES (?, ?, 0, 0, 0, 'activo')`
    ).bind(`agente-${agente.toLowerCase()}`, agente)
  );

  for (const [agente, contador] of contadores) {
    sentencias.push(
      env.DB.prepare(
        `UPDATE agentes_estado
            SET logs_procesados = logs_procesados + ?,
                logs_bloqueados = logs_bloqueados + ?,
                casos_escalados = casos_escalados + ?
          WHERE nombre = ?`
      ).bind(contador.procesados, contador.bloqueados, contador.escalados, agente)
    );
  }

  for (let i = 0; i < sentencias.length; i += MAX_SENTENCIAS_POR_BATCH) {
    await env.DB.batch(sentencias.slice(i, i + MAX_SENTENCIAS_POR_BATCH));
  }

  await insertarCasos(env, casos);
  await recalcularSalud(env, body.logs.length);

  return json({
    ok: true,
    data: {
      procesados: body.logs.length,
      escalados: casos.length,
      descartados: body.logs.length - casos.length,
    },
  });
}

async function manejarDashboard(env) {
  const { results: casos } = await env.DB.prepare(
    `SELECT * FROM casos WHERE estado IN ${ESTADOS_ACTIVOS} ORDER BY creado_en DESC LIMIT 100`
  ).all();
  const { results: agentes } = await env.DB.prepare(`SELECT * FROM agentes_estado ORDER BY nombre`).all();
  const salud = await env.DB.prepare(`SELECT salud_porcentaje FROM sistema_salud WHERE id = 1`).first();

  return json({
    ok: true,
    data: {
      salud_sistema: salud ? salud.salud_porcentaje : await recalcularSalud(env),
      casos_activos: casos,
      agentes,
    },
  });
}

async function manejarResolucionCaso(request, env, id) {
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
    `UPDATE casos SET estado = ?, resuelto_en = ? WHERE id = ?`
  )
    .bind(nuevoEstado, new Date().toISOString(), id)
    .run();

  if (!resultado.meta || resultado.meta.changes === 0) {
    return error(404, `No existe un caso con id "${id}"`, 'NO_ENCONTRADO');
  }

  const salud = await recalcularSalud(env);

  return json({ ok: true, data: { nuevo_estado: nuevoEstado, salud_sistema: salud } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === '/api/health' && method === 'GET') {
        return json({
          ok: true,
          data: {
            status: 'SOC-IA Worker Operativo',
            database: env.DB ? 'D1 Conectada' : 'D1 No conectada',
          },
        });
      }

      if (url.pathname === '/api/stream' && method === 'POST') {
        return await manejarStream(request, env);
      }

      if (url.pathname === '/api/dashboard' && method === 'GET') {
        return await manejarDashboard(env);
      }

      if (url.pathname.startsWith('/api/cases/') && method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.slice('/api/cases/'.length));
        if (!id) return error(400, 'Falta el id del caso en la ruta', 'VALIDACION');
        return await manejarResolucionCaso(request, env, id);
      }

      if (url.pathname.startsWith('/api/')) {
        return error(404, `Ruta no encontrada: ${method} ${url.pathname}`, 'NO_ENCONTRADO');
      }

      const aceptaHtml = (request.headers.get('Accept') || '').includes('text/html');
      if (aceptaHtml) {
        return new Response(paginaNoEncontrada(url.pathname), {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return error(404, `Ruta no encontrada: ${method} ${url.pathname}`, 'NO_ENCONTRADO');
    } catch (fallo) {
      // Log operativo, sin payload ni datos personales.
      console.warn(`[SOC-IA] Error no controlado en ${method} ${url.pathname}: ${fallo.message}`);
      return error(500, 'Error interno del Worker', 'ERROR_INTERNO');
    }
  },
};
