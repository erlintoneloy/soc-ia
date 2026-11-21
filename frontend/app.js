// URL base del Worker. En producción (Cloudflare Pages) define window.SOC_API_URL
// antes de cargar este script, por ejemplo:
//   <script>window.SOC_API_URL = 'https://soc-ia-worker.tu-subdominio.workers.dev/api';</script>
const API_URL = window.SOC_API_URL || 'http://127.0.0.1:8787/api';
const MAX_LINEAS_CONSOLA = 200;

const ui = {
  conectado: true,
  avisoRedMostrado: false,
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
    throw new Error(detalle);
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

function claseLog(log) {
  if (log.tipo_evento === 'powershell_encoded') return 'danger';
  if (log.tipo_evento === 'escaneo_puertos' || log.tipo_evento === 'login_fallido') return 'warning';
  if (log.fuente === 'endpoint') return 'system';
  return '';
}

// ---------- Dashboard ----------

async function cargarDashboard() {
  try {
    const json = await pedirJSON('/dashboard');

    marcarConexion(true);
    ui.avisoRedMostrado = false;

    actualizarSalud(json.data.salud_sistema);
    actualizarAgentes(json.data.agentes);
    actualizarCasos(json.data.casos_activos);
  } catch (fallo) {
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

function actualizarAgentes(agentes) {
  const contenedor = document.getElementById('agent-list');
  const lista = Array.isArray(agentes) ? agentes : [];

  if (lista.length === 0) {
    contenedor.innerHTML =
      '<div class="empty-state">Sin agentes registrados.<br>Ejecuta <code>npm run db:init</code>.</div>';
    return;
  }

  contenedor.innerHTML = lista
    .map(
      (agente) => `
        <div class="agent-card ${agente.estado === 'alerta' ? 'alerta' : ''}">
            <div class="agent-title">
                <h3>Agente ${escapeHtml(agente.nombre)}</h3>
                <span class="agent-state ${escapeHtml(agente.estado)}">${escapeHtml(agente.estado)}</span>
            </div>
            <div class="agent-stats">
                <div>📥 Procesados: ${Number(agente.logs_procesados) || 0}</div>
                <div>🛡️ Filtrados: ${Number(agente.logs_bloqueados) || 0}</div>
                <div>🚨 Escalados: ${Number(agente.casos_escalados) || 0}</div>
            </div>
        </div>`
    )
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
    .map(
      (caso) => `
        <div class="case-card ${caso.severidad === 'critica' ? 'critico' : ''}">
            <div class="case-header">
                <span class="case-title">${escapeHtml(caso.titulo)}</span>
                <span class="badge ${escapeHtml(caso.severidad)}">${escapeHtml(caso.severidad).toUpperCase()}</span>
            </div>
            <div class="case-agent">Agente: ${escapeHtml(caso.agente_responsable)}</div>
            <div class="case-ia">
                <strong>🤖 IA:</strong> ${escapeHtml(caso.resumen_ia || 'Analizando...')}<br>
                <strong>💡 Recomendación:</strong> ${escapeHtml(caso.recomendacion_ia || 'Pendiente')}
            </div>
            <div class="case-actions">
                <button class="btn-action btn-approve" data-case-id="${escapeHtml(caso.id)}" data-estado="contenido">✅ Aprobar Contención</button>
                <button class="btn-action btn-ignore" data-case-id="${escapeHtml(caso.id)}" data-estado="falso_positivo">❌ Falso Positivo</button>
            </div>
        </div>`
    )
    .join('');

  contenedor.querySelectorAll('button[data-case-id]').forEach((boton) => {
    boton.addEventListener('click', () => resolverCaso(boton.dataset.caseId, boton.dataset.estado, boton));
  });
}

async function resolverCaso(id, nuevoEstado, boton) {
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
  { fuente: 'identidad', tipo_evento: 'login_fallido', usuario: 'demo_svc', intentos: 15 },
  { fuente: 'endpoint', tipo_evento: 'powershell_encoded', host: 'WS-DEMO', payload: 'powershell -enc aGVsbG8=' },
  { fuente: 'red', tipo_evento: 'escaneo_puertos', ip: '203.0.113.7', puertos: [22, 80, 443, 3389] },
  { fuente: 'identidad', tipo_evento: 'login_exitoso', usuario: 'analista_demo' },
];

document.getElementById('btn-simulate').addEventListener('click', async (evento) => {
  const boton = evento.currentTarget;
  boton.disabled = true;
  agregarLinea('> Iniciando simulación de ataque...', 'system');

  LOTE_DEMO.forEach((log, indice) => {
    setTimeout(() => {
      const marca = new Date().toLocaleTimeString();
      agregarLinea(`[${marca}] ${log.fuente.toUpperCase()} - ${log.tipo_evento}`, claseLog(log));
    }, indice * 300);
  });

  setTimeout(async () => {
    try {
      const json = await pedirJSON('/stream', {
        method: 'POST',
        body: JSON.stringify({ logs: LOTE_DEMO }),
      });

      const { procesados, escalados, descartados } = json.data;
      mostrarAviso(`Lote enviado: ${procesados} procesados, ${escalados} escalados, ${descartados} filtrados.`, 'success');
      await cargarDashboard();
    } catch (fallo) {
      mostrarAviso(`La simulación falló: ${fallo.message}`);
    } finally {
      boton.disabled = false;
    }
  }, LOTE_DEMO.length * 300 + 300);
});

// ---------- Arranque ----------

marcarConexion(false);
cargarDashboard();
setInterval(cargarDashboard, 10000);
