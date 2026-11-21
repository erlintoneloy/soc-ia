# REGISTRO DE DECISIONES DE ARQUITECTURA (ADR)

> **Instrucción:** Documentar las decisiones importantes a medida que se toman durante el proyecto.

## ADR-01: Métricas persistidas y salud derivada de casos activos
*   **Fecha:** 2026-11-21
*   **Contexto:** El dashboard calculaba la salud al vuelo (`100 - casos * 15`) y nunca actualizaba `agentes_estado`. Los contadores del panel izquierdo quedaban en cero y la fórmula no coincidía con el SPEC. Además, todos los casos se guardaban como `alta`, por lo que CA4 (3 críticos → estado rojo) no podía cumplirse.
*   **Decisión:**
    *   Acumular los contadores por agente en memoria durante cada request y escribirlos con un único `env.DB.batch()` (troceado cada 50 sentencias).
    *   Recalcular la salud tras cada mutación (ingesta o resolución de caso) con la fórmula del SPEC: `100 - 20·críticos - 10·altos`, acotada a 0–100, y persistirla en `sistema_salud` (fila `id = 1`).
    *   Mapear severidades según el SPEC: `powershell_encoded` = crítica; `escaneo_puertos` y `login_fallido` = alta.
    *   Derivar el estado del agente: `alerta` si tiene casos activos, `activo` si no.
*   **Consecuencias:**
    *   Pros: el dashboard refleja datos reales y persistentes; CA4 y CA5 se cumplen; pocas escrituras por lote; los tests cubren el contrato completo.
    *   Contras: si el isolate cae antes del batch se pierde el delta de ese request; la tabla `logs` sigue sin usarse (trazabilidad completa queda como deuda). El estado persistido puede desincronizarse si se edita la D1 a mano, pero el dashboard recalcula cuando no existe la fila.

## ADR-02: Origen único y autenticación por sesión
*   **Fecha:** 2026-11-21
*   **Contexto:** El frontend y la API vivían en dos Workers distintos (`soc-ia` y `soc-ia-worker`). `workers.dev` está en la lista de sufijos públicos, así que cada subdominio es un sitio separado: una cookie `HttpOnly` de la API no se comparte con el dashboard. Además, la API estaba expuesta públicamente y sin autenticación.
*   **Decisión:**
    *   Consolidar assets y API en un único Worker (`soc-ia`) con `run_worker_first: ["/api/*"]`.
    *   Autenticar con email y contraseña; contraseñas con PBKDF2-SHA256 y salt por usuario.
    *   Sesiones opacas de 32 bytes; en D1 se guarda solo su SHA-256. Cookie `HttpOnly`, `SameSite=Lax`, 8 h.
    *   Rate limit de 5 fallos por IP+email con bloqueo de 15 minutos.
    *   Exigir sesión en todo `/api/*` salvo `health` y `login`; validar `Origin` en métodos mutantes.
    *   Eliminar el Worker `soc-ia-worker` para que no quede una API pública sin autenticar.
*   **Consecuencias:**
    *   Pros: sin CORS, una sola URL y un solo deploy; la API no está expuesta por separado; el login y las acciones quedan asociados a un usuario.
    *   Contras: el PBKDF2 consume CPU en el Worker (100.000 iteraciones medidas en ~0,4 s de round-trip en producción); no hay MFA ni recuperación de contraseña; las sesiones se guardan en D1 y hay que limpiar las expiradas. Las credenciales de demo están en el seed y deben cambiarse en un entorno real.

## ADR-03: Protecciones operativas contra abuso y duplicados
*   **Fecha:** 2026-11-21
*   **Contexto:** `POST /api/stream` es el punto más caro del sistema: cada escalado puede disparar una inferencia de Workers AI. Un atacante con una sesión válida (o el propio presentador haciendo varias simulaciones) podía agotar la cuota, colgar el request con decenas de inferencias secuenciales o generar un caso por cada log repetido del mismo ataque.
*   **Decisión:**
    *   Rate limit por usuario en D1 con ventana fija de 60 s: 30 ingresos/min en `/api/stream` y 60 resoluciones/min en `PATCH`.
    *   Deduplicación por `fuente|tipo_evento|IP/usuario/host` con cooldown de 60 s. Los repetidos incrementan `ocurrencias` en el caso activo en lugar de crear otro.
    *   Tope de 3 inferencias por lote; el resto se crea con resumen de respaldo y se marca `resumen_fuente = 'fallback'`.
    *   Endpoint `POST /api/demo/reset` solo para rol `admin`, que limpia casos, contadores, salud y rate limits.
*   **Consecuencias:**
    *   Pros: la cuota de IA queda acotada por lote; un ataque repetido se ve como uno solo con `×N`; el presentador puede dejar el SOC limpio antes de la demo sin tocar la CLI.
    *   Contras: el rate limit vive en D1 y agrega una escritura por ingesta; el cooldown de 60 s puede ocultar oleadas legítimas del mismo ataque (se ve en `ocurrencias`); el reset borra la evidencia histórica, por lo que no debe usarse en producción real.
