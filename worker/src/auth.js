/**
 * Autenticación por sesión con cookie HttpOnly.
 *
 * - Contraseñas: PBKDF2-SHA256 con salt por usuario.
 * - Sesiones: token aleatorio de 32 bytes; en D1 se guarda solo su SHA-256.
 * - Rate limit: 5 fallos por IP+email durante 15 minutos.
 */

export const NOMBRE_COOKIE = 'soc_sid';
export const ITERACIONES_DEFECTO = 100000;

const DURACION_SESION_MS = 8 * 60 * 60 * 1000;
const MAX_INTENTOS = 5;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
// Salt fijo para igualar el tiempo de respuesta cuando el email no existe.
const SALT_DUMMY = 'AAAAAAAAAAAAAAAAAAAAAA==';

const encoder = new TextEncoder();

function base64ABytes(base64) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function bytesABase64(bytes) {
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

function bytesABase64Url(bytes) {
  return bytesABase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function derivarPassword(password, saltBase64, iteraciones = ITERACIONES_DEFECTO) {
  const clave = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ABytes(saltBase64), iterations: iteraciones, hash: 'SHA-256' },
    clave,
    256
  );
  return bytesABase64(new Uint8Array(bits));
}

export function compararConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

async function hashToken(token) {
  const bits = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function tokenAleatorio() {
  return bytesABase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function leerCookie(request, nombre) {
  const cabecera = request.headers.get('Cookie') || '';
  for (const parte of cabecera.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;
    if (parte.slice(0, separador).trim() === nombre) {
      return parte.slice(separador + 1).trim();
    }
  }
  return null;
}

function esHttps(request) {
  return new URL(request.url).protocol === 'https:';
}

export function crearCookieSesion(token, seguro) {
  const partes = [
    `${NOMBRE_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(DURACION_SESION_MS / 1000)}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function borrarCookieSesion(seguro) {
  const partes = [`${NOMBRE_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

function ipDe(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

function claveIntentos(request, email) {
  return `${ipDe(request)}|${email}`;
}

async function estadoIntentos(env, clave) {
  const fila = await env.DB.prepare(
    `SELECT intentos, bloqueado_hasta, actualizado_en FROM intentos_login WHERE clave = ?`
  )
    .bind(clave)
    .first();

  if (!fila) return { bloqueado: false, intentos: 0 };

  if (fila.bloqueado_hasta && Date.parse(fila.bloqueado_hasta) > Date.now()) {
    return { bloqueado: true, intentos: fila.intentos, hasta: fila.bloqueado_hasta };
  }

  const vencido = Date.now() - Date.parse(fila.actualizado_en) > VENTANA_INTENTOS_MS;
  return { bloqueado: false, intentos: vencido ? 0 : fila.intentos };
}

async function registrarFallo(env, clave, intentosPrevios) {
  const intentos = intentosPrevios + 1;
  const bloqueadoHasta =
    intentos >= MAX_INTENTOS ? new Date(Date.now() + VENTANA_INTENTOS_MS).toISOString() : null;

  await env.DB.prepare(
    `INSERT INTO intentos_login (clave, intentos, bloqueado_hasta, actualizado_en)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET
       intentos = excluded.intentos,
       bloqueado_hasta = excluded.bloqueado_hasta,
       actualizado_en = excluded.actualizado_en`
  )
    .bind(clave, intentos, bloqueadoHasta, new Date().toISOString())
    .run();

  return { intentos, bloqueadoHasta };
}

async function limpiarIntentos(env, clave) {
  await env.DB.prepare(`DELETE FROM intentos_login WHERE clave = ?`).bind(clave).run();
}

export async function usuarioDesdeRequest(request, env) {
  const token = leerCookie(request, NOMBRE_COOKIE);
  if (!token) return null;

  const id = await hashToken(token);
  const fila = await env.DB.prepare(
    `SELECT s.id AS sesion_id, s.expira_en, u.id, u.email, u.nombre, u.rol, u.activo,
            u.tenant_id, t.nombre AS tenant_nombre
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
       JOIN tenants t ON t.id = u.tenant_id
      WHERE s.id = ?`
  )
    .bind(id)
    .first();

  if (!fila || !fila.activo) return null;

  if (Date.parse(fila.expira_en) <= Date.now()) {
    await env.DB.prepare(`DELETE FROM sesiones WHERE id = ?`).bind(id).run();
    return null;
  }

  return {
    id: fila.id,
    email: fila.email,
    nombre: fila.nombre,
    rol: fila.rol,
    tenant_id: fila.tenant_id,
    tenant_nombre: fila.tenant_nombre,
    sesionId: fila.sesion_id,
  };
}

async function crearSesion(env, usuario, request) {
  const ahora = new Date();
  const token = tokenAleatorio();
  const id = await hashToken(token);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sesiones WHERE expira_en <= ?`).bind(ahora.toISOString()),
    env.DB.prepare(
      `INSERT INTO sesiones (id, usuario_id, creado_en, expira_en, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      usuario.id,
      ahora.toISOString(),
      new Date(ahora.getTime() + DURACION_SESION_MS).toISOString(),
      ipDe(request),
      (request.headers.get('User-Agent') || '').slice(0, 200)
    ),
  ]);

  return token;
}

export async function cerrarSesion(env, request) {
  const token = leerCookie(request, NOMBRE_COOKIE);
  if (!token) return;
  const id = await hashToken(token);
  await env.DB.prepare(`DELETE FROM sesiones WHERE id = ?`).bind(id).run();
}

export async function manejarLogin(request, env, json, error) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, 'El cuerpo de la petición debe ser JSON válido', 'JSON_INVALIDO');
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 200) {
    return error(400, 'Email o contraseña con formato inválido', 'VALIDACION');
  }

  const clave = claveIntentos(request, email);
  const estado = await estadoIntentos(env, clave);

  if (estado.bloqueado) {
    return error(429, 'Demasiados intentos fallidos. Esperá unos minutos antes de reintentar.', 'DEMASIADOS_INTENTOS');
  }

  const usuario = await env.DB.prepare(
    `SELECT u.*, t.nombre AS tenant_nombre
       FROM usuarios u
       JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = ?`
  )
    .bind(email)
    .first();

  // Si el usuario no existe, igual derivamos con un salt fijo para no filtrar por timing.
  const iteraciones = usuario?.password_iteraciones ?? ITERACIONES_DEFECTO;
  const salt = usuario?.password_salt ?? SALT_DUMMY;
  const hash = await derivarPassword(password, salt, iteraciones);

  const valido = Boolean(usuario && usuario.activo) && compararConstante(hash, usuario.password_hash);

  if (!valido) {
    await registrarFallo(env, clave, estado.intentos);
    return error(401, 'Email o contraseña incorrectos', 'CREDENCIALES');
  }

  await limpiarIntentos(env, clave);
  const token = await crearSesion(env, usuario, request);
  const ahora = new Date().toISOString();

  await env.DB.prepare(`UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?`).bind(ahora, usuario.id).run();

  const respuesta = json({
    ok: true,
    data: {
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
        tenant_id: usuario.tenant_id,
        tenant_nombre: usuario.tenant_nombre,
      },
    },
  });

  respuesta.headers.set('Set-Cookie', crearCookieSesion(token, esHttps(request)));
  return respuesta;
}

export async function manejarLogout(request, env, json) {
  await cerrarSesion(env, request);
  const respuesta = json({ ok: true, data: { cerrada: true } });
  respuesta.headers.set('Set-Cookie', borrarCookieSesion(esHttps(request)));
  return respuesta;
}
