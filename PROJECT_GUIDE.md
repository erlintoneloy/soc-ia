# MANUAL DE OPERACIONES Y ESTÁNDARES DE CALIDAD

* **Propósito:** Guía de desarrollo estandarizada para proyectos de hackatón y entornos reales.
* **Metodología:** Prompt Maestro v4.0 (Desarrollo Acelerado con Control Estricto).
* **Stack Oficial:** Cloudflare (Workers, D1, Pages, Workers AI) + Vanilla JS / Astro.

---

## 1. Protocolo de Bloqueo (Reglas de la IA)
*   **Fase por fase:** No se avanza a la siguiente fase sin confirmación explícita del piloto.
*   **Presentación de Opciones:** Ante una decisión de arquitectura, se presentarán 2 o 3 opciones con pros y contras.
*   **Git Obligatorio:** Al final de cada bloque lógico, se entregará el mensaje de commit exacto.
*   **Pruebas por Fase:** Cada bloque debe incluir un Smoke Test o Test Unitario antes de avanzar.
*   **Diagnóstico antes de parchear:** Ante un error, se explica la causa raíz antes de dar la solución.

## 2. Stack Tecnológico (Cloudflare First)
*   **Backend:** Cloudflare Workers (JavaScript / ES Modules).
*   **Base de Datos:** Cloudflare D1 (SQLite Serverless).
*   **Frontend:** Cloudflare Pages + Vanilla JS (o Astro si el proyecto lo requiere).
*   **IA:** Cloudflare Workers AI (Modelos vigentes).
*   **Herramientas:** Git/GitHub, VS Code, DeepSeek Harness (`dsh`).

## 3. Uso del DeepSeek Harness (`dsh`)

### 3.1 Reglas de Contexto (Ahorro de Tokens)
*   **Contexto Fijo:** Pasar siempre `--reglas PROJECT_GUIDE.md` para asegurar el cumplimiento del stack y las convenciones.
*   **Contexto Quirúrgico:** Adjuntar únicamente los 1 a 3 archivos necesarios en `--archivos`. **Nunca** adjuntar `node_modules`, `.wrangler`, `.git`, `dist` ni archivos binarios.
*   **Contexto Progresivo:** Si el proyecto crece, pasar los archivos de la fase actual, no todo el repositorio.
*   **Archivos de Referencia:** Para dudas de arquitectura, adjuntar `SPEC.md` o `PRD.md` en lugar de código fuente.

### 3.2 Selección de Modelo
*   **`deepseek-chat` (Por defecto):** Para generación de código, refactorización, documentación y consultas generales. Es el más económico y rápido.
*   **`deepseek-reasoner` (Excepcional):** Solo para depuración compleja de SQL, algoritmos de correlación, lógica matemática o errores que el modelo estándar no resuelve tras 2 intentos.

### 3.3 Horarios y Cuotas
*   **Ventana Económica:** Programar las sesiones de generación intensiva de código en las horas de menor demanda de la API (consultar la tabla de precios de DeepSeek).
*   **Límite Diario:** No superar las 50 llamadas diarias a `dsh` para evitar agotar el saldo en un solo sprint.
*   **Caché de Contexto:** Si se repite una consulta similar, reutilizar la respuesta anterior en lugar de volver a llamar a la API.

### 3.4 Comandos Frecuentes

# Consulta general con reglas del proyecto
dsh --reglas PROJECT_GUIDE.md --prompt "Tu instrucción puntual..."

# Consulta con contexto de archivos específicos
dsh --reglas PROJECT_GUIDE.md --archivos worker/schema.sql --prompt "Revisa este esquema..."

# Depuración compleja (usar solo si es necesario)
dsh --reglas PROJECT_GUIDE.md --archivos worker/src/index.js --modelo deepseek-reasoner --prompt "Depura este error..."

# Consulta de arquitectura (sin código)
dsh --reglas PROJECT_GUIDE.md --archivos docs/SPEC.md --prompt "¿Cómo implemento la correlación de eventos?"

### 3.5 Flujo de Trabajo Recomendado
1.  **Paso 1:** Identificar la tarea y el archivo afectado.
2.  **Paso 2:** Ejecutar `dsh` con `--reglas` y `--archivos` (máximo 3).
3.  **Paso 3:** Revisar la respuesta de la IA (nunca copiar/pegar sin leer).
4.  **Paso 4:** Aplicar el cambio en VS Code.
5.  **Paso 5:** Probar el cambio (Smoke Test).
6.  **Paso 6:** Hacer commit con el mensaje estandarizado.

### 3.6 Reglas de Seguridad con `dsh`
*   **Nunca** pasar claves API, tokens o secretos en el prompt.
*   **Nunca** pasar datos personales reales (PII) al modelo.
*   **Nunca** ejecutar comandos de `dsh` que generen archivos directamente en el repositorio sin revisión previa.
*   **Siempre** revisar que el código generado cumpla con el `Definition of Done` (sección 5).

## 4. Reglas de Git y Versionado
*   **Ramas:** `main` (estable), `develop` (integración), `feat/nombre-tarea` (trabajo individual).
*   **Commits Atómicos:** 
    *   `feat:` Nueva funcionalidad o endpoint.
    *   `fix:` Corrección de error o ajuste de validación.
    *   `docs:` Cambios en documentación (PRD, SPEC, ADR).
    *   `style:` Ajustes visuales CSS/UI sin cambios de lógica.
    *   `refactor:` Limpieza interna de código sin alterar contratos.
    *   `test:` Datos sintéticos o pruebas de endpoints.
*   **Secretos:** Claves y tokens en `.dev.vars` o Secrets de Cloudflare. Nunca en el repositorio.

## 5. Estándares de Calidad (Definition of Done)
*   [ ] **Código Limpio:** Nombres semánticos, sin código muerto ni `console.log` de depuración.
*   [ ] **Seguridad Básica:** Validación estricta de entradas y cabeceras CORS controladas.
*   [ ] **Manejo de Errores:** Respuestas JSON uniformes (`{ "ok": false, "error": "..." }`).
*   [ ] **Responsive Design:** Interfaz legible en escritorio y móvil.
*   [ ] **Trazabilidad:** Commits atómicos en rama propia revisados antes de integrar a `main`.

## 6. Uso Ético de la IA
*   **Explicabilidad:** La IA no es una caja negra. El sistema debe explicar sus decisiones al usuario.
*   **Human-in-the-loop:** La IA apoya la decisión, pero el humano tiene la última palabra.
*   **Privacidad:** No enviar datos personales reales a los modelos de IA.
