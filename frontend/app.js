const API_URL = 'http://127.0.0.1:8787/api';

// 1. Cargar Dashboard al iniciar
async function cargarDashboard() {
    try {
        const res = await fetch(`${API_URL}/dashboard`);
        const json = await res.json();
        if (json.ok) {
            actualizarSalud(json.data.salud_sistema);
            actualizarAgentes(json.data.agentes);
            actualizarCasos(json.data.casos_activos);
        }
    } catch (error) {
        console.error("Error conectando al Worker:", error);
    }
}

// 2. Actualizar Barra de Salud
function actualizarSalud(porcentaje) {
    const bar = document.getElementById('health-bar');
    const text = document.getElementById('health-text');
    
    bar.style.width = `${porcentaje}%`;
    text.innerText = `${porcentaje}%`;

    if (porcentaje > 70) bar.style.backgroundColor = 'var(--success)';
    else if (porcentaje > 30) bar.style.backgroundColor = 'var(--warning)';
    else bar.style.backgroundColor = 'var(--danger)';
}

// 3. Actualizar Agentes
function actualizarAgentes(agentes) {
    const container = document.getElementById('agent-list');
    container.innerHTML = agentes.map(a => `
        <div class="agent-card ${a.estado === 'alerta' ? 'alerta' : ''}">
            <h3>Agente ${a.nombre}</h3>
            <div class="agent-stats">
                <div>📥 Procesados: ${a.logs_procesados}</div>
                <div>🛡️ Bloqueados: ${a.logs_bloqueados}</div>
                <div>🚨 Escalados: ${a.casos_escalados}</div>
            </div>
        </div>
    `).join('');
}

// 4. Actualizar Casos Escalados
function actualizarCasos(casos) {
    const container = document.getElementById('cases-list');
    if (casos.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); text-align:center;">No hay casos pendientes. Sistema seguro.</div>';
        return;
    }

    container.innerHTML = casos.map(c => `
        <div class="case-card ${c.severidad === 'critica' ? 'critico' : ''}">
            <div class="case-header">
                <span class="case-title">${c.titulo}</span>
                <span class="badge ${c.severidad}">${c.severidad.toUpperCase()}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                Agente: ${c.agente_responsable}
            </div>
            <div class="case-ia">
                <strong>🤖 IA:</strong> ${c.resumen_ia || 'Analizando...'}<br>
                <strong>💡 Recomendación:</strong> ${c.recomendacion_ia || 'Pendiente'}
            </div>
            <div class="case-actions">
                <button class="btn-action btn-approve" onclick="resolverCaso('${c.id}', 'contenido')">✅ Aprobar Contención</button>
                <button class="btn-action btn-ignore" onclick="resolverCaso('${c.id}', 'falso_positivo')">❌ Falso Positivo</button>
            </div>
        </div>
    `).join('');
}

// 5. Resolver Caso (PATCH)
async function resolverCaso(id, nuevoEstado) {
    try {
        const res = await fetch(`${API_URL}/cases/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        if (res.ok) {
            cargarDashboard(); // Recargar para actualizar salud y casos
        }
    } catch (error) {
        console.error("Error al resolver caso:", error);
    }
}

// 6. Simulador de Lluvia de Logs (Para la demo)
document.getElementById('btn-simulate').addEventListener('click', async () => {
    const consoleDiv = document.getElementById('logs-console');
    consoleDiv.innerHTML += `<div class="log-line system">> Iniciando simulación de ataque...</div>`;

    // Generar logs falsos
    const tipos = [
        { fuente: 'identidad', tipo: 'login_fallido', intentos: 10, class: 'warning' },
        { fuente: 'endpoint', tipo: 'powershell_encoded', class: 'danger' },
        { fuente: 'red', tipo: 'escaneo_puertos', class: 'warning' }
    ];

    for (let i = 0; i < 10; i++) {
        setTimeout(() => {
            const log = tipos[Math.floor(Math.random() * tipos.length)];
            consoleDiv.innerHTML += `<div class="log-line ${log.class}">[${new Date().toLocaleTimeString()}] ${log.fuente.toUpperCase()} - ${log.tipo}</div>`;
            consoleDiv.scrollTop = consoleDiv.scrollHeight; // Auto-scroll
        }, i * 300); // Un log cada 300ms
    }

    // Enviar el lote al backend después de la animación
    setTimeout(async () => {
        const payload = {
            logs: [
                { fuente: 'identidad', tipo_evento: 'login_fallido', intentos: 15 },
                { fuente: 'endpoint', tipo_evento: 'powershell_encoded', payload: 'powershell -enc aGVsbG8=' },
                { fuente: 'red', tipo_evento: 'escaneo_puertos' }
            ]
        };
        await fetch(`${API_URL}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        cargarDashboard();
    }, 3000); // Esperar a que termine la animación
});

// Cargar al inicio
cargarDashboard();
// Refrescar cada 10 segundos
setInterval(cargarDashboard, 10000);