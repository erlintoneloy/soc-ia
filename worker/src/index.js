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

    // --- 2. INGESTA DE LOGS CON IA ---
    if (url.pathname === '/api/stream' && method === 'POST') {
      try {
        const body = await request.json();
        const logs = body.logs || [];
        let procesados = 0, escalados = 0, descartados = 0;

        for (const log of logs) {
          procesados++;
          let esCritico = false, tituloCaso = "", agenteResponsable = "";

          // Lógica de Detección
          if (log.fuente === 'red' && log.tipo_evento === 'escaneo_puertos') {
            esCritico = true; tituloCaso = "Escaneo de puertos detectado"; agenteResponsable = 'Agente Red';
          } else if (log.fuente === 'identidad' && log.tipo_evento === 'login_fallido' && log.intentos > 5) {
            esCritico = true; tituloCaso = "Posible ataque de fuerza bruta"; agenteResponsable = 'Agente Identidad';
          } else if (log.fuente === 'endpoint' && log.tipo_evento === 'powershell_encoded') {
            esCritico = true; tituloCaso = "Ejecución de PowerShell ofuscado"; agenteResponsable = 'Agente Endpoint';
          }

          if (esCritico) {
            escalados++;
            const casoId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            
            // Generar resumen IA (Fallback en caso de error)
            let resumenIA = `Evento ${tituloCaso} detectado por ${agenteResponsable}. Requiere revisión.`;
            let recomendacionIA = "Aislar el activo afectado y revisar los logs.";

            try {
              const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
                messages: [
                  { role: 'system', content: 'Eres un Analista SOC Senior. Responde ESTRICTAMENTE en formato JSON con esta estructura: {"resumen": "explicacion en 2 lineas", "recomendacion": "accion tecnica en 1 linea"}. No agregues markdown ni texto extra.' },
                  { role: 'user', content: `Evento: ${tituloCaso} detectado por ${agenteResponsable}. Datos: ${JSON.stringify(log)}` }
                ]
              });
              
              // El formato real de Cloudflare Workers AI (Llama 3) viene en choices[0].message.content
              let textoIA = "";
              if (aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message) {
                textoIA = aiResponse.choices[0].message.content;
              } else if (aiResponse.response) {
                textoIA = aiResponse.response; // Por si acaso
              }

              if (textoIA) {
                // Limpiamos los backticks de markdown si existen
                const jsonLimpio = textoIA.replace(/```json|```/g, '').trim();
                const parsed = JSON.parse(jsonLimpio);
                resumenIA = parsed.resumen || resumenIA;
                recomendacionIA = parsed.recomendacion || recomendacionIA;
              }

            } catch (aiError) {
              console.error("IA Falló:", aiError.message);
            }

            // Guardar en D1
            await env.DB.prepare(
              `INSERT INTO casos (id, titulo, severidad, agente_responsable, resumen_ia, recomendacion_ia, estado, creado_en) 
               VALUES (?, ?, ?, ?, ?, ?, 'escalado', ?)`
            ).bind(casoId, tituloCaso, 'alta', agenteResponsable, resumenIA, recomendacionIA, timestamp).run();

          } else {
            descartados++;
          }
        }

        return new Response(JSON.stringify({ ok: true, data: { procesados, escalados, descartados } }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: "Error en el motor: " + error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // --- 3. DASHBOARD DATA ---
    if (url.pathname === '/api/dashboard' && method === 'GET') {
      try {
        const { results: casos } = await env.DB.prepare(`SELECT * FROM casos WHERE estado IN ('escalado', 'en_triaje') ORDER BY creado_en DESC LIMIT 20`).all();
        const { results: agentes } = await env.DB.prepare(`SELECT * FROM agentes_estado`).all();
        
        // Calcular salud (simulada por ahora, basada en casos activos)
        const salud = Math.max(0, 100 - (casos.length * 15));

        return new Response(JSON.stringify({ 
          ok: true, 
          data: { 
            salud_sistema: salud, 
            casos_activos: casos, 
            agentes: agentes 
          } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // --- 4. ACTUALIZAR CASO (Triage Humano) ---
    if (url.pathname.startsWith('/api/cases/') && method === 'PATCH') {
      try {
        const id = url.pathname.split('/').pop();
        const body = await request.json();
        const nuevoEstado = body.estado;
        
        await env.DB.prepare(`UPDATE casos SET estado = ?, resuelto_en = ? WHERE id = ?`)
          .bind(nuevoEstado, new Date().toISOString(), id).run();
          
        return new Response(JSON.stringify({ ok: true, data: { actualizado: true } }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Fallback
    return new Response(JSON.stringify({ ok: false, error: "Ruta no encontrada" }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
