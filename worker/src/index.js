export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Manejo de CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Preflight request
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Ruta de Health Check
    if (url.pathname === '/api/health' && method === 'GET') {
      return new Response(JSON.stringify({ 
        ok: true, 
        data: { 
          status: "SOC-IA Worker Operativo", 
          timestamp: new Date().toISOString(),
          database: env.DB ? "D1 Conectada" : "D1 No conectada"
        } 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fallback
    return new Response(JSON.stringify({ 
      ok: false, 
      error: "Ruta no encontrada en el SOC-IA" 
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
