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

## ADR-04: Inventario de activos y prioridad por criticidad
*   **Fecha:** 2026-11-21
*   **Contexto:** Los casos decían "escaneo de puertos" sin indicar qué activo estaba afectado, de qué área dependía ni cuánto importaba. El analista no podía priorizar y la IA recomendaba en abstracto. Además, el mismo ataque en dos equipos distintos se deduplicaba por usuario/IP y podía colapsar en un solo caso.
*   **Decisión:**
    *   Sembrar un inventario ficticio (**Clínica Valle Verde**) de 18 activos con hostname, IP, tipo, área, responsable, servicio, criticidad y SO.
    *   Resolver el activo por `host` y, si falta, por `destino_ip`, con caché por request. Sin coincidencia → `activo_id = NULL` y la UI muestra "activo desconocido".
    *   Guardar en cada caso `activo_id`, `tipo_evento`, `ip_origen`, `usuario_afectado` y `evidencia_json` (500 caracteres máximo).
    *   Calcular prioridad como `severidad × criticidad` (P1/P2/P3) sin tocar la fórmula de salud del SPEC.
    *   Incluir el activo afectado en la clave de deduplicación, para que dos equipos distintos generen dos casos.
    *   Pasar el contexto del activo al prompt de Workers AI.
*   **Consecuencias:**
    *   Pros: los casos tienen impacto de negocio y evidencia; la prioridad permite triage real; las recomendaciones de la IA son específicas; el dedupe distingue por activo.
    *   Contras: una consulta extra por host nuevo en cada lote (mitigada con caché); el inventario es estático y hay que mantenerlo; los logs sin `host` ni `destino_ip` quedan como desconocidos. La prioridad no afecta la salud, así que un activo crítico con severidad alta puede dejar la barra en verde aunque sea P1: es una decisión consciente para preservar CA4.

## ADR-05: Directorio de usuarios de negocio
*   **Fecha:** 2026-11-21
*   **Contexto:** Los casos mostraban un identificador (`jefe.finanzas`) sin nombre, rol ni área. El analista no sabía a quién afectaba el incidente, y la IA recomendaba sobre un usuario anónimo. Además, el botón de simulación del frontend seguía enviando el payload viejo, sin host ni usuario, y generaba casos con "activo desconocido" y solo la IP.
*   **Decisión:**
    *   Crear `usuarios_negocio` (username, nombre, rol, área, activo asignado, email) con 9 usuarios ficticios coherentes con el inventario.
    *   Enlazar los casos por `usuario_afectado` y devolver `usuario_perfil` en el dashboard.
    *   Mostrar `👤 Nombre (Rol)` en la tarjeta, con el email como tooltip, y usar el perfil en el prompt de la IA.
    *   Actualizar el lote de demostración del frontend para apuntar a activos y usuarios reales del inventario.
    *   Hacer que el smoke test reinicie la demo al inicio para partir de un estado limpio.
*   **Consecuencias:**
    *   Pros: el caso cuenta a quién afecta y con qué rol; las recomendaciones de la IA son más humanas; la demo web y la de consola producen el mismo contexto; los tests dejan de depender de datos residuales.
    *   Contras: los usuarios son ficticios y estáticos; un username fuera del directorio se muestra sin perfil; el reset inicial del suite borra los casos existentes (aceptable para pruebas y demo, no para producción real).

## ADR-06: Logs persistidos y consola con polling incremental
*   **Fecha:** 2026-11-21
*   **Contexto:** La consola de logs era una animación del navegador: el frontend inventaba líneas, enviaba un lote fijo y no quedaba historial. La tabla `logs` existía pero nunca se escribía. Además, dos clientes no veían los mismos eventos y un refresh borraba la consola.
*   **Decisión:**
    *   Persistir cada log en D1 con `host`, `destino_ip`, `activo_id`, `usuario`, `resultado` (`escalado`/`descartado`/`duplicado`) y payload truncado a 2.000 caracteres.
    *   Exponer `GET /api/logs?after=<seq>&limit=100` con cursor por `rowid`; la primera carga devuelve los últimos 50.
    *   Consumir ese endpoint desde el frontend con polling cada 1,5 s, deduplicando por `seq` y conservando el historial entre recargas.
    *   Retención de 24 h aplicada en una fracción de los requests y limpieza total en el reset de demo.
    *   Mantener la consola acotada a 200 líneas en el DOM.
*   **Consecuencias:**
    *   Pros: la lluvia es real y compartida; el historial sobrevive a un refresh; el resultado de cada log se ve en color; no requiere Durable Objects ni conexiones largas; el costo es una consulta liviana por cliente cada 1,5 s.
    *   Contras: no es push real, la latencia puede llegar a 1,5 s; con muchos clientes aumenta el número de lecturas a D1; los logs viejos se borran a las 24 h. SSE con Durable Objects queda como mejora si se necesita tiempo real estricto.

## ADR-07: Explorador de logs con filtros y exportación
*   **Fecha:** 2026-11-21
*   **Contexto:** La consola en vivo solo mostraba los eventos recientes (últimos 50 al entrar, 200 en el DOM). No había forma de buscar un host, un usuario o un rango horario, ni de sacar evidencia del sistema sin consultar la base a mano.
*   **Decisión:**
    *   Extender `GET /api/logs` con filtros (`fuente`, `resultado`, `host`, `usuario`, `q`, `desde`, `hasta`), modo `sentido=desc` y cursor `before` para páginas anteriores.
    *   Agregar `format=csv` con hasta 1.000 filas y los filtros aplicados.
    *   Implementar un modal "Explorador de logs" con formulario de filtros, tabla paginada y exportación.
    *   Validar `fuente` y `resultado` en el backend (400 ante valores inválidos).
*   **Consecuencias:**
    *   Pros: se puede investigar sin tocar la CLI; el CSV sirve como evidencia; la consola en vivo queda intacta; todo sigue detrás de sesión.
    *   Contras: los filtros de texto usan `LIKE` sin índice dedicado (aceptable con 24 h de retención); la exportación está acotada a 1.000 filas; no hay una vista de "detalle del log" con el payload completo (el campo existe en la base, pero la tabla no lo muestra).

## ADR-08: Detección stateful con ventanas de 60 s
*   **Fecha:** 2026-11-21
*   **Contexto:** La regla de fuerza bruta confiaba en `log.intentos`, un campo que envía el cliente: bastaba con mandar un log con `intentos: 15` para escalar. El escaneo escalaba con un solo evento y el Agente de Red no auto-bloqueaba nada. Además, el motor vivía dentro de `index.js` y no se podía testear sin levantar el Worker.
*   **Decisión:**
    *   Extraer las reglas puras a `worker/src/engine.js` (eventos, prioridad, deduplicación, umbrales).
    *   Contar eventos persistidos en `logs` en una ventana de 60 s, con una única consulta agrupada por usuario/IP al inicio de cada lote.
    *   Umbrales: **6 fallos** del mismo usuario (el sexto escala, los cinco previos quedan `observado`) y **101 requests** del mismo origen (la 101 se auto-bloquea como `bloqueado`).
    *   Agregar los resultados `observado` y `bloqueado` al modelo, la API, la consola y el explorador.
    *   Cubrir el motor con pruebas unitarias (`node:test`) y un workflow de GitHub Actions.
*   **Consecuencias:**
    *   Pros: la detección ya no depende de datos del cliente; el flood se contiene solo; el motor es testeable sin Worker; CI detecta regresiones en cada push/PR.
    *   Contras: una consulta extra por lote para las ventanas; si el insert de logs falla, la ventana queda corta; los umbrales son constantes y no configurables por entorno; la ventana usa el timestamp de ingesta, no un reloj deslizante exacto.

## ADR-09: Multi-tenant con columna `tenant_id`
*   **Fecha:** 2026-11-21
*   **Contexto:** El sistema atendía una sola organización. Para mostrar aislamiento real hacía falta que dos organizaciones compartieran la misma base sin poder verse entre sí.
*   **Decisión:**
    *   Agregar `tenant_id` a `logs`, `casos`, `usuarios`, `activos`, `agentes_estado`, `usuarios_negocio` y `sistema_salud`.
    *   Reconstruir las tablas con unicidad por tenant (`activos` por hostname, `agentes_estado` por nombre, `usuarios_negocio` por username, una fila de salud por tenant).
    *   Derivar el tenant de la sesión (`JOIN tenants` en auth) y filtrar todas las consultas por él.
    *   Mantener un admin por tenant; el reset solo borra los casos, logs y contadores de esa organización.
    *   Sembrar dos tenants ficticios: Clínica Valle Verde y Banco Litoral.
    *   Mostrar la organización en la barra superior y cubrir el aislamiento con un test end-to-end.
*   **Consecuencias:**
    *   Pros: aislamiento real de datos, agentes y salud; el mismo despliegue sirve a varias organizaciones; los tests verifican que un tenant no ve ni modifica casos ajenos.
    *   Contras: cada consulta debe recordar el filtro por tenant (riesgo de olvido al agregar features); no hay un superadmin global; la migración reconstruye cuatro tablas; `rate_limit` e `intentos_login` siguen siendo globales por usuario/IP, no por tenant; sigue siendo una sola base D1 (no hay aislamiento físico).

## ADR-10: Auditoría de acciones y tokens de simulación
*   **Fecha:** 2026-11-21
*   **Contexto:** Las acciones del analista (login, triage, reset) no dejaban rastro, y la consola de ataque externa necesitaba autenticarse sin compartir la cookie de un analista. Además, la contención se ejecutaba con un solo clic, sin confirmación.
*   **Decisión:**
    *   Crear `auditoria` (tenant, usuario, rol, acción, detalle, IP) y registrar login, logout, triage, reset, creación/revocación de tokens y simulaciones.
    *   Exponer `GET /api/auditoria` solo para admin y un panel **Auditoría** en la barra superior.
    *   Confirmar la contención (y el falso positivo) en un modal antes de ejecutar el `PATCH`.
    *   Crear `tokens_simulacion` por tenant: token `socsim_...`, hash SHA-256, revocable, solo ingesta.
    *   Habilitar `POST /api/simulate` con `Authorization: Bearer`, CORS para el origen de la consola y rate limit por token.
*   **Consecuencias:**
    *   Pros: trazabilidad de las acciones humanas; la consola externa no reutiliza credenciales de analista; el token es revocable y de mínimo privilegio; la auditoría no se borra con el reset.
    *   Contras: la auditoría es *best-effort* (un fallo al escribir no rompe la acción); `auditoria` crece sin retención automática; los tokens no tienen scopes granulares (solo ingesta) ni rotación automática; CORS `*` en `/api/simulate` (el token es la protección); el panel de auditoría no pagina más de 200 filas.
