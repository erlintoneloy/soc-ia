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
