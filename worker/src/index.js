export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // --- 1. HEALTH CHECK ---
    if (url.pathname === '/api/health' && method === 'GET') {
      return new Response(JSON.stringify({ 
        ok: true, 
        data: { status: "SOC-IA Worker Operativo", database: env.DB ? "D1 Conectada" : "D1 No conectada" } 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- 2. INGESTA DE LOGS (La Lluvia) ---
    if (url.pathname === '/api/stream' && method === 'POST') {
      try {
        const body = await request.json();
        const logs = body.logs || [];
        
        let procesados = 0;
        let escalados = 0;
        let descartados = 0;

        for (const log of logs) {
          procesados++;
          
          // Lógica de los Agentes (Reglas Deterministas)
          let esCritico = false;
          let tituloCaso = "";
          let agenteResponsable = "";

          if (log.fuente === 'red') {
            agenteResponsable = 'Agente Red';
            if (log.tipo_evento === 'escaneo_puertos') {
              esCritico = true;
              tituloCaso = "Escaneo de puertos detectado";
            }
          } else if (log.fuente === 'identidad') {
            agenteResponsable = 'Agente Identidad';
            if (log.tipo_evento === 'login_fallido' && log.intentos > 5) {
              esCritico = true;
              tituloCaso = "Posible ataque de fuerza bruta";
            }
          } else if (log.fuente === 'endpoint') {
            agenteResponsable = 'Agente Endpoint';
            if (log.tipo_evento === 'powershell_encoded') {
              esCritico = true;
              tituloCaso = "Ejecución de PowerShell ofuscado";
            }
          }

          // Si es crítico, lo escalamos al humano (guardamos en D1)
          if (esCritico) {
            escalados++;
            const casoId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            
            // Insertar en la tabla de casos (SQL parametrizado para evitar inyección)
            await env.DB.prepare(
              `INSERT INTO casos (id, titulo, severidad, agente_responsable, estado, creado_en) 
               VALUES (?, ?, ?, ?, 'escalado', ?)`
            ).bind(casoId, tituloCaso, 'alta', agenteResponsable, timestamp).run();
          } else {
            // El agente lo resolvió o era ruido
            descartados++;
          }
        }

        return new Response(JSON.stringify({ 
          ok: true, 
          data: { procesados, escalados, descartados } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: "JSON inválido o error en el motor" }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Fallback
    return new Response(JSON.stringify({ ok: false, error: "Ruta no encontrada" }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
