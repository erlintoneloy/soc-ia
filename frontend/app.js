// URL base de la API. El dashboard y el Worker comparten origen.
const API_URL = window.SOC_API_URL || '/api';
const MAX_LINEAS_CONSOLA = 200;

const ui = {
  conectado: true,
  avisoRedMostrado: false,
};

const app = {
  usuario: null,
  intervalo: null,
  logsIntervalo: null,
  logSeq: 0,
  cargandoLogs: false,
};

const explorador = {
  anterior: null,
  cargando: false,
  pagina: 0,
};

// ---------- Utilidades ----------

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caracter) => {
    const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return mapa[caracter];
  });
}

function mostrarAviso(mensaje, tipo = 'error') {
  const contenedor = document.getElementById('toasts');
  const aviso = document.createElement('div');
  aviso.className = `toast ${tipo}`;
  aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  aviso.textContent = mensaje;
  contenedor.appendChild(aviso);

  setTimeout(() => {
    aviso.classList.add('saliendo');
    setTimeout(() => aviso.remove(), 250);
  }, 5000);
}

function marcarConexion(conectado) {
  const indicador = document.getElementById('conn-status');
  indicador.textContent = conectado ? '● En línea' : '● Sin conexión';
  indicador.className = `conn-status ${conectado ? 'ok' : 'offline'}`;
  ui.conectado = conectado;
}

async function pedirJSON(ruta, opciones = {}) {
  const respuesta = await fetch(`${API_URL}${ruta}`, {
    ...opciones,
    headers: {
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opciones.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });

  const texto = await respuesta.text();
  let json = null;

  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(`Respuesta no válida del servidor (HTTP ${respuesta.status})`);
  }

  if (!respuesta.ok || !json?.ok) {
    const detalle = json?.error || `El servidor respondió HTTP ${respuesta.status}`;
    const fallo = new Error(detalle);
    fallo.status = respuesta.status;
    fallo.code = json?.code;
    throw fallo;
  }

  return json;
}

function agregarLinea(texto, clase = '') {
  const consola = document.getElementById('logs-console');
  const linea = document.createElement('div');
  linea.className = `log-line ${clase}`.trim();
  linea.textContent = texto;
  consola.appendChild(linea);

  while (consola.childElementCount > MAX_LINEAS_CONSOLA) {
    consola.firstElementChild.remove();
  }

  consola.scrollTop = consola.scrollHeight;
}

function formatearLog(log) {
  const hora = new Date(log.timestamp).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const destino = log.host || log.destino_ip || 'sin activo';
  const actor = log.usuario ? ` (${log.usuario})` : '';
  return `[${hora}] ${String(log.fuente).toUpperCase()} ${log.tipo_evento} ${destino}${actor} → ${log.resultado}`;
}

function claseLogServidor(log) {
  if (log.resultado === 'duplicado' || log.resultado === 'observado') return 'system';
  if (log.resultado === 'bloqueado') return 'blocked';
  if (log.resultado === 'escalado') {
    return log.tipo_evento === 'powershell_encoded' ? 'danger' : 'warning';
  }
  return '';
}

function limpiarConsola(mensaje = '> Sin actividad todavía.') {
  const consola = document.getElementById('logs-console');
  consola.innerHTML = '';
  if (!mensaje) return;
  agregarLinea(mensaje, 'system');
  consola.lastElementChild.dataset.placeholder = '1';
}

async function cargarLogs() {
  if (app.cargandoLogs) return;
  app.cargandoLogs = true;

  try {
    const json = await pedirJSON(`/logs?after=${app.logSeq}&limit=100`);

    if (json.data.logs.length > 0) {
      const placeholder = document.querySelector('#logs-console [data-placeholder="1"]');
      if (placeholder) placeholder.remove();
    }

    for (const log of json.data.logs) {
      agregarLinea(formatearLog(log), claseLogServidor(log));
      app.logSeq = Math.max(app.logSeq, Number(log.seq) || 0);
    }
  } catch (fallo) {
    if (fallo.status === 401) mostrarLogin('Tu sesión expiró. Volvé a ingresar.');
    // Los fallos de red se reintentan en el próximo ciclo sin llenar la pantalla de avisos.
  } finally {
    app.cargandoLogs = false;
  }
}

// ---------- Autenticación ----------

function mostrarErrorLogin(mensaje) {
  const nodo = document.getElementById('login-error');
  if (!mensaje) {
    nodo.hidden = true;
    nodo.textContent = '';
    return;
  }
  nodo.textContent = mensaje;
  nodo.hidden = false;
}

function mostrarLogin(mensaje = '') {
  app.usuario = null;

  if (app.intervalo) {
    clearInterval(app.intervalo);
    app.intervalo = null;
  }
  if (app.logsIntervalo) {
    clearInterval(app.logsIntervalo);
    app.logsIntervalo = null;
  }
  app.logSeq = 0;
  app.cargandoLogs = false;
  cerrarExplorador();
  cerrarAuditoria();
  cerrarConfirmacion();

  document.getElementById('app-shell').hidden = true;
  document.getElementById('login-screen').hidden = false;
  document.getElementById('user-chip').textContent = '';
  document.getElementById('tenant-chip').textContent = '';
  mostrarErrorLogin(mensaje);
}

async function entrarApp(usuario) {
  app.usuario = usuario;

  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;
  document.getElementById('user-chip').innerHTML = `<b>${escapeHtml(usuario.nombre)}</b> · ${escapeHtml(usuario.rol)}`;
  document.getElementById('tenant-chip').textContent = usuario.tenant_nombre || '';
  document.getElementById('btn-reset').hidden = usuario.rol !== 'admin';
  document.getElementById('btn-audit').hidden = usuario.rol !== 'admin';
  cerrarExplorador();
  cerrarAuditoria();
  cerrarConfirmacion();

  mostrarErrorLogin('');
  marcarConexion(true);

  ajustarEcg();
  prellenarEcg();
  dibujarEcg();
  dibujarDonut();
  dibujarBarras();

  limpiarConsola();
  app.logSeq = 0;

  await cargarDashboard();
  await cargarLogs();

  if (!app.usuario) return;
  if (!app.intervalo) app.intervalo = setInterval(cargarDashboard, 5000);
  if (!app.logsIntervalo) app.logsIntervalo = setInterval(cargarLogs, 1500);
}

async function iniciarSesion() {
  try {
    const json = await pedirJSON('/auth/me');
    await entrarApp(json.data.usuario);
  } catch (fallo) {
    if (fallo.status === 401) mostrarLogin();
    else mostrarLogin(`No se pudo verificar la sesión: ${fallo.message}`);
  }
}

document.getElementById('login-form').addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const boton = document.getElementById('login-submit');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  boton.disabled = true;
  mostrarErrorLogin('');

  try {
    const json = await pedirJSON('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    document.getElementById('login-password').value = '';
    await entrarApp(json.data.usuario);
  } catch (fallo) {
    mostrarErrorLogin(fallo.message);
  } finally {
    boton.disabled = false;
  }
});

document.getElementById('btn-reset').addEventListener('click', async (evento) => {
  const confirmado = window.confirm(
    'Esto borra todos los casos y reinicia las métricas del SOC. ¿Querés continuar?'
  );
  if (!confirmado) return;

  const boton = evento.currentTarget;
  boton.disabled = true;

  try {
    const json = await pedirJSON('/demo/reset', { method: 'POST' });
    app.logSeq = 0;
    limpiarConsola('> Demo reiniciada. Sin actividad todavía.');
    mostrarAviso(`Demo reiniciada: ${json.data.casos_eliminados} casos eliminados.`, 'success');
    await cargarDashboard();
    await cargarLogs();
  } catch (fallo) {
    mostrarAviso(`No se pudo reiniciar la demo: ${fallo.message}`);
  } finally {
    boton.disabled = false;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  const boton = document.getElementById('btn-logout');
  boton.disabled = true;

  try {
    await pedirJSON('/auth/logout', { method: 'POST' });
  } catch {
    // Aunque falle la red, cerramos la vista local.
  } finally {
    boton.disabled = false;
    mostrarLogin();
  }
});

// ---------- Dashboard ----------

async function cargarDashboard() {
  try {
    const json = await pedirJSON('/dashboard');

    marcarConexion(true);
    ui.avisoRedMostrado = false;

    actualizarSalud(json.data.salud_sistema);
    actualizarAgentes(json.data.agentes, json.data.metricas);
    actualizarCasos(json.data.casos_activos);
    actualizarGraficos(json.data);
  } catch (fallo) {
    if (fallo.status === 401) {
      mostrarLogin('Tu sesión expiró. Volvé a ingresar.');
      return;
    }

    marcarConexion(false);

    if (!ui.avisoRedMostrado) {
      ui.avisoRedMostrado = true;
      mostrarAviso(`No se pudo cargar el dashboard: ${fallo.message}`);
    }
  }
}

function actualizarSalud(porcentaje) {
  const valor = Math.max(0, Math.min(100, Number(porcentaje) || 0));
  const barra = document.getElementById('health-bar');
  const texto = document.getElementById('health-text');

  barra.style.width = `${valor}%`;
  texto.innerText = `${valor}%`;

  // Umbrales del PRD: verde > 80, amarillo 50-80, rojo < 50.
  if (valor > 80) barra.style.backgroundColor = 'var(--success)';
  else if (valor >= 50) barra.style.backgroundColor = 'var(--warning)';
  else barra.style.backgroundColor = 'var(--danger)';
}

function actualizarAgentes(agentes, metricas) {
  const contenedor = document.getElementById('agent-list');
  const lista = Array.isArray(agentes) ? agentes : [];
  const porNombre = new Map(((metricas && metricas.agentes) || []).map((item) => [item.nombre, item]));

  if (lista.length === 0) {
    contenedor.innerHTML =
      '<div class="empty-state">Sin agentes registrados.<br>Ejecuta <code>npm run db:init</code>.</div>';
    return;
  }

  contenedor.innerHTML = lista
    .map((agente) => {
      const metrica = porNombre.get(agente.nombre) || { escalados: 0, atendidos: 0, activos: 0 };

      return `
        <div class="agent-card ${agente.estado === 'alerta' ? 'alerta' : ''}">
            <div class="agent-title">
                <h3>Agente ${escapeHtml(agente.nombre)}</h3>
                <span class="agent-state ${escapeHtml(agente.estado)}">${escapeHtml(agente.estado)}</span>
            </div>
            <div class="agent-stats">
                <div>📥 Procesados: ${Number(agente.logs_procesados) || 0}</div>
                <div>🛡️ Filtrados: ${Number(agente.logs_bloqueados) || 0}</div>
                <div>🚨 Activos: ${metrica.activos}</div>
            </div>
            <div class="agent-sub">Histórico: ${metrica.escalados} escalados · ${metrica.atendidos} atendidos</div>
        </div>`;
    })
    .join('');
}

function actualizarCasos(casos) {
  const contenedor = document.getElementById('cases-list');
  const lista = Array.isArray(casos) ? casos : [];

  if (lista.length === 0) {
    contenedor.innerHTML =
      '<div class="empty-state">No hay casos pendientes.<br>Sistema seguro.</div>';
    return;
  }

  contenedor.innerHTML = lista
    .map((caso) => {
      const activo = caso.activo;
      const bloqueActivo = activo
        ? `<div class="case-asset">
                <span class="asset-host">${escapeHtml(activo.hostname)}</span>
                <span class="asset-detail">${escapeHtml(activo.departamento || 'sin área')} · ${escapeHtml(activo.servicio || 'sin servicio')}</span>
                <span class="asset-crit ${escapeHtml(activo.criticidad)}">${escapeHtml(activo.criticidad).toUpperCase()}</span>
            </div>`
        : '<div class="case-asset desconocido">Activo desconocido</div>';

      const perfil = caso.usuario_perfil;
      const usuarioTexto = perfil
        ? `<span class="case-user" title="${escapeHtml(perfil.email || '')}">👤 ${escapeHtml(perfil.nombre)} <span class="case-user-role">(${escapeHtml(perfil.rol || perfil.area || 'usuario')})</span></span>`
        : caso.usuario_afectado
          ? `<span class="case-user">👤 ${escapeHtml(caso.usuario_afectado)}</span>`
          : '';
      const origenTexto = caso.ip_origen
        ? `<span class="case-origin">Origen: ${escapeHtml(caso.ip_origen)}</span>`
        : '';
      const bloqueEvidencia =
        usuarioTexto || origenTexto
          ? `<div class="case-evidence">${[usuarioTexto, origenTexto].filter(Boolean).join('<span class="case-sep">·</span>')}</div>`
          : '';

      return `
        <div class="case-card ${caso.severidad === 'critica' ? 'critico' : ''}">
            <div class="case-header">
                <span class="case-title">${escapeHtml(caso.titulo)}</span>
                <span class="case-meta">
                    ${Number(caso.ocurrencias) > 1 ? `<span class="case-repeats" title="Repeticiones del mismo ataque">×${Number(caso.ocurrencias)}</span>` : ''}
                    ${caso.prioridad ? `<span class="priority ${escapeHtml(caso.prioridad.toLowerCase())}">${escapeHtml(caso.prioridad)}</span>` : ''}
                    <span class="badge ${escapeHtml(caso.severidad)}">${escapeHtml(caso.severidad).toUpperCase()}</span>
                </span>
            </div>
            <div class="case-agent">Agente: ${escapeHtml(caso.agente_responsable)}</div>
            ${bloqueActivo}
            ${bloqueEvidencia}
            <div class="case-ia">
                <strong>🤖 IA:</strong> ${escapeHtml(caso.resumen_ia || 'Analizando...')}
                ${caso.resumen_fuente === 'fallback' ? '<span class="case-tag">respaldo</span>' : ''}<br>
                <strong>💡 Recomendación:</strong> ${escapeHtml(caso.recomendacion_ia || 'Pendiente')}
            </div>
            <div class="case-actions">
                <button class="btn-action btn-approve" data-case-id="${escapeHtml(caso.id)}" data-case-title="${escapeHtml(caso.titulo)}" data-estado="contenido">✅ Aprobar Contención</button>
                <button class="btn-action btn-ignore" data-case-id="${escapeHtml(caso.id)}" data-case-title="${escapeHtml(caso.titulo)}" data-estado="falso_positivo">❌ Falso Positivo</button>
            </div>
        </div>`;
    })
    .join('');

  contenedor.querySelectorAll('button[data-case-id]').forEach((boton) => {
    boton.addEventListener('click', () =>
      resolverCaso(boton.dataset.caseId, boton.dataset.estado, boton, boton.dataset.caseTitle)
    );
  });
}

async function resolverCaso(id, nuevoEstado, boton, titulo) {
  const esContencion = nuevoEstado === 'contenido';

  pedirConfirmacion({
    titulo: esContencion ? 'Aprobar contención' : 'Marcar falso positivo',
    mensaje: `¿Confirmás ${esContencion ? 'aprobar la contención' : 'marcar como falso positivo'} del caso “${titulo || 'seleccionado'}”?`,
    texto: esContencion ? 'Aprobar contención' : 'Marcar falso positivo',
    onConfirmar: () => ejecutarResolucion(id, nuevoEstado, boton),
  });
}

async function ejecutarResolucion(id, nuevoEstado, boton) {
  if (boton) boton.disabled = true;

  try {
    const json = await pedirJSON(`/cases/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: nuevoEstado }),
    });

    const mensaje =
      nuevoEstado === 'contenido'
        ? `Caso contenido. Salud del SOC: ${json.data.salud_sistema}%.`
        : 'Caso marcado como falso positivo.';

    mostrarAviso(mensaje, 'success');
    await cargarDashboard();
  } catch (fallo) {
    mostrarAviso(`No se pudo resolver el caso: ${fallo.message}`);
  } finally {
    if (boton) boton.disabled = false;
  }
}

// ---------- Simulador de demo ----------

const LOTE_DEMO = [
  ...Array.from({ length: 8 }, () => ({
    fuente: 'identidad',
    tipo_evento: 'login_fallido',
    usuario: 'jefe.finanzas',
    host: 'WS-FAC-05',
    destino_ip: '10.20.50.5',
    ip_origen: '198.51.100.23',
    intentos: 1,
  })),
  {
    fuente: 'endpoint',
    tipo_evento: 'powershell_encoded',
    usuario: 'admin.ti',
    host: 'SRV-HIS-01',
    destino_ip: '10.20.80.11',
    ip_origen: '203.0.113.50',
    payload: 'powershell -enc aGVsbG8=',
  },
  {
    fuente: 'red',
    tipo_evento: 'escaneo_puertos',
    host: 'FW-PERIMETRO-01',
    destino_ip: '10.20.80.1',
    ip_origen: '203.0.113.45',
    puertos: [22, 80, 443, 3389],
  },
  {
    fuente: 'identidad',
    tipo_evento: 'login_exitoso',
    usuario: 'admision.01',
    host: 'WS-ADM-11',
    destino_ip: '10.20.40.11',
  },
];

const LOTE_BANCO = [
  ...Array.from({ length: 8 }, () => ({
    fuente: 'identidad',
    tipo_evento: 'login_fallido',
    usuario: 'cajero.01',
    host: 'WS-CAJA-05',
    destino_ip: '10.30.20.5',
    ip_origen: '198.51.100.90',
    intentos: 1,
  })),
  {
    fuente: 'endpoint',
    tipo_evento: 'powershell_encoded',
    usuario: 'admin.banco',
    host: 'SRV-CORE-01',
    destino_ip: '10.30.80.11',
    ip_origen: '203.0.113.70',
    payload: 'powershell -enc aGVsbG8=',
  },
  {
    fuente: 'red',
    tipo_evento: 'escaneo_puertos',
    host: 'FW-BANCO-01',
    destino_ip: '10.30.80.1',
    ip_origen: '203.0.113.71',
    puertos: [22, 443, 3389],
  },
  {
    fuente: 'identidad',
    tipo_evento: 'login_exitoso',
    usuario: 'jefe.tesoreria',
    host: 'SRV-HOME-01',
    destino_ip: '10.30.80.12',
  },
];

function loteDemo() {
  return app.usuario?.tenant_id === 'banco-litoral' ? LOTE_BANCO : LOTE_DEMO;
}

document.getElementById('btn-simulate').addEventListener('click', async (evento) => {
  const boton = evento.currentTarget;
  boton.disabled = true;
  agregarLinea('> Enviando lote de simulación al SOC...', 'system');

  try {
    const json = await pedirJSON('/stream', {
      method: 'POST',
      body: JSON.stringify({ logs: loteDemo() }),
    });

    const { procesados, casos_creados, duplicados, descartados, observados, bloqueados } = json.data;
    const filtrados = (descartados || 0) + (observados || 0) + (bloqueados || 0);
    mostrarAviso(
      `Lote enviado: ${procesados} procesados, ${casos_creados} casos nuevos, ${duplicados} duplicados, ${filtrados} filtrados.`,
      'success'
    );

    await cargarDashboard();
    await cargarLogs();
  } catch (fallo) {
    mostrarAviso(`La simulación falló: ${fallo.message}`);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Gráficos ----------

const COLORES_ATAQUES = ['#ef4444', '#f97316', '#eab308', '#0ea5e9', '#a855f7', '#22c55e'];
const ECG_MUESTRA_MS = 40;
const ECG_MAX_MUESTRAS = 225;
const LATIDO = [0, 0, 1, 2, 1, 0, -1, -2, 0, 9, 16, -7, -12, 4, 2, 0, 0, 1, 2, 1, 0, 0, 0, 0];

const graficos = {
  salud: 100,
  ataques: [],
  agentes: [],
};

const ecg = {
  ctx: null,
  ancho: 0,
  alto: 0,
  muestras: [],
  fase: 0,
  salud: 100,
  objetivo: 100,
  acumulado: 0,
  ultimoFrame: 0,
};

function ajustarCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const ancho = Math.max(1, Math.round(rect.width));
  const alto = Math.max(1, Math.round(rect.height));

  canvas.width = Math.round(ancho * dpr);
  canvas.height = Math.round(alto * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { ctx, ancho, alto };
}

function colorSalud(salud) {
  if (salud > 80) return '#22c55e';
  if (salud >= 50) return '#f59e0b';
  return '#ef4444';
}

function ajustarEcg() {
  const { ctx, ancho, alto } = ajustarCanvas(document.getElementById('chart-ecg'));
  ecg.ctx = ctx;
  ecg.ancho = ancho;
  ecg.alto = alto;
}

function prellenarEcg() {
  ecg.muestras = [];
  for (let i = 0; i < ECG_MAX_MUESTRAS; i++) {
    ecg.muestras.push(50 + LATIDO[i % LATIDO.length]);
  }
  ecg.fase = ECG_MAX_MUESTRAS % LATIDO.length;
}

function dibujarEcg() {
  const { ctx, ancho, alto } = ecg;
  if (!ctx) return;

  ctx.clearRect(0, 0, ancho, alto);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
  ctx.lineWidth = 1;

  for (let fila = 1; fila < 4; fila++) {
    const y = (alto / 4) * fila;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ancho, y);
    ctx.stroke();
  }

  for (let columna = 1; columna < 8; columna++) {
    const x = (ancho / 8) * columna;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, alto);
    ctx.stroke();
  }

  const color = colorSalud(ecg.salud);
  const paso = ancho / (ECG_MAX_MUESTRAS - 1);
  const inicio = ECG_MAX_MUESTRAS - ecg.muestras.length;

  if (ecg.muestras.length > 1) {
    ctx.beginPath();
    ecg.muestras.forEach((valor, indice) => {
      const x = (inicio + indice) * paso;
      const y = alto - (Math.max(0, Math.min(100, valor)) / 100) * alto;
      if (indice === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  if (ecg.muestras.length > 0) {
    const ultimo = ecg.muestras[ecg.muestras.length - 1];
    const y = alto - (Math.max(0, Math.min(100, ultimo)) / 100) * alto;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ancho - 2, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bucleEcg(timestamp) {
  requestAnimationFrame(bucleEcg);

  if (document.hidden) {
    ecg.ultimoFrame = timestamp;
    return;
  }

  if (!ecg.ultimoFrame) ecg.ultimoFrame = timestamp;

  const delta = Math.min(120, timestamp - ecg.ultimoFrame);
  ecg.ultimoFrame = timestamp;
  ecg.acumulado += delta;

  while (ecg.acumulado >= ECG_MUESTRA_MS) {
    ecg.acumulado -= ECG_MUESTRA_MS;
    ecg.fase = (ecg.fase + 1) % LATIDO.length;
    ecg.salud += (ecg.objetivo - ecg.salud) * 0.06;

    // Con salud baja el trazo se vuelve errático, como una arritmia.
    const inestabilidad = Math.max(0, (70 - ecg.salud) / 70);
    const ruido = (Math.random() - 0.5) * 26 * inestabilidad;
    const amplitud = 1 + inestabilidad * 1.6;

    ecg.muestras.push(50 + LATIDO[ecg.fase] * amplitud + ruido);
    if (ecg.muestras.length > ECG_MAX_MUESTRAS) ecg.muestras.shift();
  }

  dibujarEcg();
}

function etiquetaAtaque(titulo) {
  if (/escaneo/i.test(titulo)) return 'Escaneo';
  if (/fuerza bruta/i.test(titulo)) return 'Fuerza bruta';
  if (/powershell/i.test(titulo)) return 'PowerShell';
  return titulo;
}

function dibujarDonut() {
  const { ctx, ancho, alto } = ajustarCanvas(document.getElementById('chart-ataques'));
  const leyenda = document.getElementById('donut-legend');
  const datos = graficos.ataques;
  const total = datos.reduce((suma, item) => suma + item.total, 0);

  const cx = ancho / 2;
  const cy = alto / 2;
  const radio = Math.max(10, Math.min(ancho, alto) / 2 - 7);
  const grosor = Math.max(8, radio * 0.34);

  ctx.clearRect(0, 0, ancho, alto);
  ctx.lineWidth = grosor;

  if (total === 0) {
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    let angulo = -Math.PI / 2;
    datos.forEach((item, indice) => {
      const arco = (item.total / total) * Math.PI * 2;
      ctx.strokeStyle = COLORES_ATAQUES[indice % COLORES_ATAQUES.length];
      ctx.beginPath();
      ctx.arc(cx, cy, radio, angulo, angulo + Math.max(0.02, arco - 0.02));
      ctx.stroke();
      angulo += arco;
    });
  }

  ctx.fillStyle = '#f3f4f6';
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy - 4);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.fillText(total === 1 ? 'caso' : 'casos', cx, cy + 10);

  leyenda.innerHTML =
    datos.length === 0
      ? '<li>Sin ataques registrados</li>'
      : datos
          .slice(0, 4)
          .map(
            (item, indice) => `
              <li>
                <i class="dot" style="background-color:${COLORES_ATAQUES[indice % COLORES_ATAQUES.length]}"></i>
                <span>${escapeHtml(etiquetaAtaque(item.titulo))}</span>
                <b>${item.total}</b>
              </li>`
          )
          .join('');
}

function dibujarBarras() {
  const { ctx, ancho, alto } = ajustarCanvas(document.getElementById('chart-agentes'));
  const datos = graficos.agentes;

  ctx.clearRect(0, 0, ancho, alto);

  const totalEscalados = datos.reduce((suma, item) => suma + item.escalados, 0);

  if (totalEscalados === 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Sin casos todavía', ancho / 2, alto / 2);
    return;
  }

  const maximo = Math.max(1, ...datos.map((item) => item.escalados));
  const areaEtiqueta = 52;
  const areaNumero = 34;
  const anchoBarra = Math.max(10, ancho - areaEtiqueta - areaNumero);
  const altoFila = alto / datos.length;
  const altoBarra = Math.max(4, Math.min(8, altoFila * 0.22));
  const separacion = 2;

  datos.forEach((item, indice) => {
    const y = indice * altoFila + (altoFila - (altoBarra * 2 + separacion)) / 2;

    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.nombre, 0, y + altoBarra);

    ctx.fillStyle = '#f97316';
    ctx.fillRect(areaEtiqueta, y, (item.escalados / maximo) * anchoBarra, altoBarra);

    ctx.fillStyle = '#22c55e';
    ctx.fillRect(
      areaEtiqueta,
      y + altoBarra + separacion,
      (item.atendidos / maximo) * anchoBarra,
      altoBarra
    );

    ctx.fillStyle = '#e5e7eb';
    ctx.textAlign = 'right';
    ctx.fillText(`${item.atendidos}/${item.escalados}`, ancho, y + altoBarra);
  });
}

function actualizarGraficos(data) {
  graficos.salud = Math.max(0, Math.min(100, Number(data.salud_sistema) || 0));
  graficos.ataques = Array.isArray(data.metricas?.ataques_por_tipo) ? data.metricas.ataques_por_tipo : [];
  graficos.agentes = Array.isArray(data.metricas?.agentes) ? data.metricas.agentes : [];

  ecg.objetivo = graficos.salud;

  const lectura = document.getElementById('ecg-reading');
  lectura.textContent = `${graficos.salud}%`;
  lectura.style.color = colorSalud(graficos.salud);

  dibujarDonut();
  dibujarBarras();
}

// ---------- Explorador de logs ----------

function abrirExplorador() {
  document.getElementById('log-explorer').hidden = false;
  buscarLogsExplorador({ reiniciar: true });
}

function cerrarExplorador() {
  const modal = document.getElementById('log-explorer');
  if (modal) modal.hidden = true;
}

function filtrosExplorador() {
  const params = new URLSearchParams();
  const fuente = document.getElementById('f-fuente').value;
  const resultado = document.getElementById('f-resultado').value;
  const host = document.getElementById('f-host').value.trim();
  const usuario = document.getElementById('f-usuario').value.trim();
  const q = document.getElementById('f-q').value.trim();
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;

  if (fuente) params.set('fuente', fuente);
  if (resultado) params.set('resultado', resultado);
  if (host) params.set('host', host);
  if (usuario) params.set('usuario', usuario);
  if (q) params.set('q', q);
  if (desde) params.set('desde', new Date(desde).toISOString());
  if (hasta) params.set('hasta', new Date(new Date(hasta).getTime() + 59999).toISOString());

  return params;
}

function formatearHoraLog(valor) {
  return new Date(valor).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function renderizarExplorador(logs) {
  const cuerpo = document.getElementById('log-table-body');
  const vacio = document.getElementById('log-explorer-empty');
  const cuenta = document.getElementById('log-explorer-count');

  cuerpo.innerHTML = logs
    .map(
      (log) => `
        <tr>
            <td class="mono">${escapeHtml(formatearHoraLog(log.timestamp))}</td>
            <td>${escapeHtml(String(log.fuente).toUpperCase())}</td>
            <td>${escapeHtml(log.tipo_evento)}</td>
            <td class="mono">${escapeHtml(log.host || log.destino_ip || '—')}</td>
            <td>${escapeHtml(log.usuario || '—')}</td>
            <td><span class="result-badge ${escapeHtml(log.resultado)}">${escapeHtml(log.resultado)}</span></td>
        </tr>`
    )
    .join('');

  vacio.hidden = logs.length > 0;
  cuenta.textContent = logs.length ? `${logs.length} log${logs.length === 1 ? '' : 's'}` : '';

  document.getElementById('btn-older').disabled = !explorador.anterior;
  document.getElementById('btn-newer').disabled = explorador.pagina === 0;
}

async function buscarLogsExplorador({ reiniciar = true, antes = null } = {}) {
  if (explorador.cargando) return;
  explorador.cargando = true;

  const params = filtrosExplorador();
  params.set('sentido', 'desc');
  params.set('limit', '50');
  if (!reiniciar && antes) params.set('before', String(antes));

  try {
    const json = await pedirJSON(`/logs?${params.toString()}`);
    explorador.anterior = json.data.anterior;
    explorador.pagina = reiniciar ? 0 : explorador.pagina + 1;
    renderizarExplorador(json.data.logs);
  } catch (fallo) {
    if (fallo.status === 401) mostrarLogin('Tu sesión expiró. Volvé a ingresar.');
    else mostrarAviso(`No se pudo cargar el historial: ${fallo.message}`);
  } finally {
    explorador.cargando = false;
  }
}

document.getElementById('btn-explorer').addEventListener('click', abrirExplorador);
document.getElementById('btn-close-explorer').addEventListener('click', cerrarExplorador);

document.getElementById('log-filters').addEventListener('submit', (evento) => {
  evento.preventDefault();
  buscarLogsExplorador({ reiniciar: true });
});

document.getElementById('btn-clear-filters').addEventListener('click', () => {
  document.getElementById('log-filters').reset();
  explorador.anterior = null;
  buscarLogsExplorador({ reiniciar: true });
});

document.getElementById('btn-older').addEventListener('click', () => {
  if (explorador.anterior) buscarLogsExplorador({ reiniciar: false, antes: explorador.anterior });
});

document.getElementById('btn-newer').addEventListener('click', () => {
  explorador.anterior = null;
  buscarLogsExplorador({ reiniciar: true });
});

document.getElementById('btn-export-csv').addEventListener('click', () => {
  const params = filtrosExplorador();
  params.set('format', 'csv');
  window.open(`${API_URL}/logs?${params.toString()}`, '_blank');
});

document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape') return;

  if (!document.getElementById('log-explorer').hidden) return cerrarExplorador();
  if (!document.getElementById('audit-modal').hidden) return cerrarAuditoria();
  if (!document.getElementById('confirm-modal').hidden) return cerrarConfirmacion();
});

// ---------- Confirmación ----------

let confirmacionPendiente = null;

function pedirConfirmacion({ titulo, mensaje, texto, onConfirmar }) {
  document.getElementById('confirm-title').textContent = titulo;
  document.getElementById('confirm-message').textContent = mensaje;
  document.getElementById('confirm-ok').textContent = texto;

  confirmacionPendiente = onConfirmar;
  document.getElementById('confirm-modal').hidden = false;
}

function cerrarConfirmacion() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.hidden = true;
  confirmacionPendiente = null;
}

document.getElementById('confirm-ok').addEventListener('click', async () => {
  const accion = confirmacionPendiente;
  cerrarConfirmacion();
  if (accion) await accion();
});

document.getElementById('confirm-cancel').addEventListener('click', cerrarConfirmacion);
document.getElementById('confirm-close').addEventListener('click', cerrarConfirmacion);

// ---------- Auditoría ----------

const ACCIONES_AUDITORIA = {
  login: 'Inicio de sesión',
  logout: 'Cierre de sesión',
  triage: 'Triage de caso',
  reset: 'Reset de demo',
  token_creado: 'Token creado',
  token_revocado: 'Token revocado',
  simulacion: 'Simulación con token',
};

function etiquetaAccion(accion) {
  return ACCIONES_AUDITORIA[accion] || accion;
}

function resumenDetalle(detalle) {
  if (!detalle) return '—';

  const partes = [];
  if (detalle.caso) partes.push(`caso ${String(detalle.caso).slice(0, 8)}…`);
  if (detalle.estado) partes.push(detalle.estado);
  if (detalle.casos_eliminados !== undefined) partes.push(`${detalle.casos_eliminados} casos`);
  if (detalle.token) partes.push(`token ${detalle.token}`);
  if (detalle.casos_creados !== undefined) partes.push(`${detalle.casos_creados} nuevos`);
  if (detalle.procesados !== undefined) partes.push(`${detalle.procesados} procesados`);
  if (detalle.bloqueados) partes.push(`${detalle.bloqueados} bloqueados`);
  if (detalle.tenant) partes.push(detalle.tenant);

  return partes.length ? partes.join(' · ') : '—';
}

async function cargarAuditoria() {
  try {
    const json = await pedirJSON('/auditoria?limit=100');
    const filas = json.data.auditoria || [];
    const cuerpo = document.getElementById('audit-table-body');

    cuerpo.innerHTML = filas
      .map(
        (fila) => `
        <tr>
            <td class="mono">${escapeHtml(formatearHoraLog(fila.creado_en))}</td>
            <td>${escapeHtml(fila.usuario_email || 'sistema')}</td>
            <td>${escapeHtml(etiquetaAccion(fila.accion))}</td>
            <td>${escapeHtml(resumenDetalle(fila.detalle))}</td>
            <td class="mono">${escapeHtml(fila.ip || '—')}</td>
        </tr>`
      )
      .join('');

    document.getElementById('audit-empty').hidden = filas.length > 0;
    document.getElementById('audit-count').textContent = `${filas.length} acción${
      filas.length === 1 ? '' : 'es'
    }`;
  } catch (fallo) {
    if (fallo.status === 401) mostrarLogin('Tu sesión expiró. Volvé a ingresar.');
    else mostrarAviso(`No se pudo cargar la auditoría: ${fallo.message}`);
  }
}

function abrirAuditoria() {
  document.getElementById('audit-modal').hidden = false;
  cargarAuditoria();
}

function cerrarAuditoria() {
  const modal = document.getElementById('audit-modal');
  if (modal) modal.hidden = true;
}

document.getElementById('btn-audit').addEventListener('click', abrirAuditoria);
document.getElementById('btn-close-audit').addEventListener('click', cerrarAuditoria);
document.getElementById('btn-refresh-audit').addEventListener('click', cargarAuditoria);

// ---------- Arranque ----------

let temporizadorResize;
window.addEventListener('resize', () => {
  clearTimeout(temporizadorResize);
  temporizadorResize = setTimeout(() => {
    if (document.getElementById('app-shell').hidden) return;
    ajustarEcg();
    dibujarDonut();
    dibujarBarras();
  }, 150);
});

requestAnimationFrame(bucleEcg);
mostrarLogin();
iniciarSesion();
