# SPEC TÉCNICA — SOC-IA (Flota de Agentes)

**Versión:** 1.0
**Basado en:** PRD v2.0
**Stack:** Cloudflare Workers + D1 + Pages + Workers AI

---

## 1. Arquitectura del Sistema
*   **Frontend:** Cloudflare Pages. Alojará el Dashboard (HTML/CSS/Vanilla JS). Se comunicará con el Worker vía `fetch`.
*   **Backend:** Cloudflare Worker. Actuará como router, motor de reglas y orquestador de IA.
*   **Base de Datos:** D1 para persistencia de logs, casos y estado del sistema.
*   **IA:** Cloudflare Workers AI (Modelo `@cf/meta/llama-3.1-8b-instruct`).

## 2. Modelo de Datos (D1)

### Tabla: `logs`
Almacena cada evento crudo que entra al sistema.
*   `id` TEXT PRIMARY KEY (UUIDv4)
*   `timestamp` TEXT NOT NULL (ISO-8601)
*   `fuente` TEXT NOT NULL CHECK (fuente IN ('red', 'identidad', 'endpoint'))
*   `tipo_evento` TEXT NOT NULL (ej. 'login_fallido', 'puerto_escaneado')
*   `ip_origen` TEXT
*   `usuario` TEXT
*   `payload_json` TEXT NOT NULL
*   `procesado` BOOLEAN DEFAULT 0

### Tabla: `casos`
Almacena los incidentes escalados que requieren atención humana.
*   `id` TEXT PRIMARY KEY (UUIDv4)
*   `titulo` TEXT NOT NULL
*   `severidad` TEXT NOT NULL CHECK (severidad IN ('baja', 'media', 'alta', 'critica'))
*   `agente_responsable` TEXT NOT NULL (ej. 'Agente Endpoint')
*   `resumen_ia` TEXT
*   `recomendacion_ia` TEXT
*   `estado` TEXT NOT NULL CHECK (estado IN ('escalado', 'en_triaje', 'contenido', 'falso_positivo'))
*   `creado_en` TEXT NOT NULL
*   `resuelto_en` TEXT

### Tabla: `agentes_estado`
Almacena las métricas de cada agente para el dashboard.
*   `nombre` TEXT PRIMARY KEY (ej. 'Red', 'Identidad', 'Endpoint')
*   `logs_procesados` INTEGER DEFAULT 0
*   `logs_bloqueados` INTEGER DEFAULT 0
*   `casos_escalados` INTEGER DEFAULT 0
*   `estado` TEXT CHECK (estado IN ('activo', 'alerta', 'offline'))

### Tabla: `sistema_salud`
Almacena el estado del sistema para la barra superior.
*   `id` INTEGER PRIMARY KEY AUTOINCREMENT
*   `salud_porcentaje` INTEGER NOT NULL (0-100)
*   `amenazas_activas` INTEGER DEFAULT 0
*   `logs_por_segundo` INTEGER DEFAULT 0
*   `actualizado_en` TEXT NOT NULL

## 3. Contratos de API

### `POST /api/stream`
*   **Propósito:** Recibir la lluvia de logs desde el simulador o herramientas externas.
*   **Payload:** `{ "logs": [ { "fuente": "identidad", "tipo_evento": "login_fallido", "ip": "1.1.1.1", ... } ] }`
*   **Respuesta:** `{ "ok": true, "data": { "procesados": 10, "descartados": 8, "escalados": 2 } }`

### `GET /api/dashboard`
*   **Propósito:** Proveer todo lo necesario para pintar la pantalla principal en una sola llamada.
*   **Respuesta:** 
    ```json
    {
      "ok": true,
      "data": {
        "salud_sistema": 85,
        "agentes": [ { "nombre": "Red", "estado": "activo", "bloqueados": 50 }, ... ],
        "casos_activos": [ { "id": "...", "titulo": "...", "severidad": "alta", "resumen_ia": "...", "estado": "escalado" } ]
      }
    }
    ```

### `PATCH /api/cases/:id`
*   **Propósito:** Cambiar el estado de un caso (el analista aprueba la contención).
*   **Payload:** `{ "estado": "contenido" }`
*   **Respuesta:** `{ "ok": true, "data": { "nuevo_estado": "contenido", "salud_sistema": 95 } }`

## 4. Lógica de los Agentes (Reglas Deterministas)
Para no agotar la IA en cada log, usaremos código JavaScript puro en el Worker. La IA solo se llama al final.

*   **Agente de Red:** Si detecta > 100 requests con la misma IP en 1 minuto -> Auto-bloquea (lo descarta). Si detecta escaneo de puertos -> Escala.
*   **Agente de Identidad:** Si detecta > 5 logins fallidos con el mismo usuario en 1 minuto -> Escala a caso "Fuerza Bruta". Si es 1 solo fallo -> Lo descarta.
*   **Agente de Endpoint:** Si detecta `powershell.exe` con el parámetro `-enc` (encoded) -> Escala a caso "Ejecución Sospechosa".
*   **Actualización de Salud:** `Salud = 100 - (Casos Críticos * 20) - (Casos Altos * 10)`. Si baja de 50, es Rojo.

## 5. Integración de IA (Cloudflare Workers AI)
*   **Modelo:** `@cf/meta/llama-3.1-8b-instruct`
*   **Prompt del Sistema:**
    > "Eres un Analista SOC Senior. Recibes un evento de seguridad de severidad {severidad} detectado por el {agente}. 
    > Genera un resumen ejecutivo de 2 líneas explicando qué pasó. 
    > Genera una recomendación técnica de 1 línea (ej. 'Aislar el endpoint', 'Bloquear la IP').
    > Responde en formato JSON estricto: {"resumen": "...", "recomendacion": "..."}"
*   **Fallback:** Si la IA falla o se agota la cuota, el Worker debe devolver un resumen genérico: *"Evento {tipo_evento} detectado en {fuente}. Requiere revisión manual."*

## 6. Simulador de Lluvia de Logs
*   Crearemos un script en `tests/simulator.js` (o un botón en el frontend) que envíe ráfagas de logs al endpoint `/api/stream` para hacer la demo visual impactante.

