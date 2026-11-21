/**
 * Motor de reglas del SOC. Funciones puras para poder testearlas sin Worker.
 */

export const AGENTE_POR_FUENTE = {
  red: 'Red',
  identidad: 'Identidad',
  endpoint: 'Endpoint',
};

export const REGLAS = {
  'red:escaneo_puertos': {
    severidad: 'alta',
    titulo: 'Escaneo de puertos detectado',
  },
  'identidad:login_fallido': {
    severidad: 'alta',
    titulo: 'Posible ataque de fuerza bruta',
  },
  'endpoint:powershell_encoded': {
    severidad: 'critica',
    titulo: 'Ejecución de PowerShell ofuscado',
  },
};

/** Más de 5 fallos en 60 s (el sexto dispara). */
export const UMBRAL_FUERZA_BRUTA = 6;
/** Más de 100 requests en 60 s (la 101 dispara). */
export const UMBRAL_AUTO_BLOQUEO = 101;
export const VENTANA_DETECCION_MS = 60 * 1000;

export const RESULTADOS = ['escalado', 'observado', 'descartado', 'duplicado', 'bloqueado'];

const ESCALA = { baja: 1, media: 2, alta: 3, critica: 4 };

export function evaluarEvento(log) {
  const regla = REGLAS[`${log.fuente}:${log.tipo_evento}`];
  if (!regla) return null;

  return {
    agente: AGENTE_POR_FUENTE[log.fuente],
    severidad: regla.severidad,
    titulo: regla.titulo,
  };
}

export function actorDeLog(log) {
  return String(log.usuario || log.ip_origen || log.ip || log.host || 'desconocido').slice(0, 120);
}

export function claveDedupe(log) {
  const partes = [log.host, log.destino_ip, log.usuario, log.ip_origen || log.ip].filter(Boolean);
  const actor = partes.length ? partes.join('|') : 'desconocido';
  return `${log.fuente}|${log.tipo_evento}|${String(actor).slice(0, 200)}`;
}

export function calcularPrioridad(severidad, criticidad) {
  const puntaje = (ESCALA[severidad] || 2) * (ESCALA[criticidad] || 2);
  if (puntaje >= 12) return 'P1';
  if (puntaje >= 6) return 'P2';
  return 'P3';
}

export function superaUmbral(previos, lote, umbral) {
  return previos + lote >= umbral;
}
