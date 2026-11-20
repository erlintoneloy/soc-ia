# PRODUCT REQUIREMENTS DOCUMENT (PRD) — SOC-IA (Flota de Agentes)

**Versión:** 2.0 (MVP Hackatón - Visión Agentes Autónomos)
**Metodología:** Prompt Maestro v4.0
**Stack:** Cloudflare (Workers + D1 + Pages) + Vanilla JS / Astro + Workers AI

---

## 1. Problema y Contexto
*   **El Dolor:** Los analistas de seguridad sufren de "fatiga de alertas". Reciben miles de logs por minuto y se ahogan en falsos positivos o ataques triviales.
*   **La Solución (Nuestra Visión):** Un SOC que no espera a que el humano lo haga todo. Implementamos una **Flota de Agentes de IA** que procesan la lluvia de logs en tiempo real. Si el ataque es simple, el agente lo resuelve o descarta. Solo los ataques complejos y destructivos llegan al analista humano, junto con una recomendación detallada de la IA.
*   **El Estado del Sistema:** El dashboard refleja la "salud" de la infraestructura. Si los ataques superan la capacidad de los agentes, la salud baja (Rojo). Si los agentes contienen el ataque, la salud vuelve a subir (Verde).

## 2. Usuarios y Casos de Uso
*   **Usuario Principal:** El Analista SOC (Supervisor de los Agentes).
*   **Caso de Uso Principal:** El analista entra al dashboard. Ve en la consola central una lluvia de logs. El "Agente de Identidad" detecta 50 intentos de login fallidos y bloquea la IP automáticamente (lo registra en verde). Pero el "Agente de Endpoint" detecta un script sospechoso y no sabe si es una herramienta legítima de TI, así que lo escala al panel derecho (rojo). El analista lee la recomendación del agente, verifica el estado del sistema (que ha bajado al 60%) y aprueba la contención con un clic.

## 3. Alcance del MVP (Construible en 48h)
*   **SÍ Hacemos:**
    *   **Backend Worker:** Endpoints para `/api/stream` (recibir logs), `/api/agents` (estado de la flota), `/api/cases` (casos escalados) y `/api/system-health` (salud del sistema).
    *   **Los 3 Agentes (Lógica Simulada):**
        1.  **Agente de Red:** Detecta escaneos de puertos y DDoS. (Regla simple: >100 requests/segundo).
        2.  **Agente de Identidad:** Detecta fuerza bruta y logins anómalos. (Regla: >5 fallos en 1 minuto).
        3.  **Agente de Endpoint:** Detecta ejecución de PowerShell sospechoso. (Regla: Binario no firmado o proceso `-enc`).
    *   **IA Real (Workers AI):** Cuando un agente escala un caso, se usa Llama 3.1 para generar el resumen del caso, explicar por qué el agente no pudo resolverlo y dar la recomendación exacta de contención.
    *   **Dashboard (Vanilla JS):** 
        *   **Barra Superior:** "Salud del SOC" (0-100%) que fluctúa según los ataques.
        *   **Panel Izquierdo:** Estado de los 3 Agentes (procesados, bloqueados, alertas).
        *   **Panel Central:** Consola de logs en vivo (lluvia de logs).
        *   **Panel Derecho:** Casos escalados al humano con recomendación IA y botón de contención.
*   **NO Hacemos (Stretch Goals):**
    *   Agentes de IA entrenados con modelos propios (usaremos reglas + LLM para el resumen).
    *   Conexión real a infraestructura (usaremos un script simulador que dispara logs al Worker).
    *   Acciones destructivas sin confirmación del humano.

## 4. Requisitos Funcionales (RF)
*   **RF1 (Ingesta y Enrutamiento):** El sistema debe recibir un JSON con logs, determinar su origen (Red, Identidad o Endpoint) y pasarlo a la lógica del agente correspondiente.
*   **RF2 (Autonomía del Agente):** Si un log activa una regla de severidad BAJA o MEDIA, el agente lo marca como "Auto-Contenido". Si es ALTA o CRÍTICA y requiere acción destructiva, lo envía a la cola de escalado.
*   **RF3 (Resumen IA):** Para cada caso escalado, el sistema debe llamar a Workers AI y generar un texto que diga: *"Agente X detectó esto. No pude contenerlo porque... Te recomiendo hacer..."*
*   **RF4 (Estado del Sistema):** La barra superior debe reflejar un cálculo dinámico basado en la cantidad de ataques activos vs. la cantidad de logs descartados/bloqueados.
*   **RF5 (Consola en Vivo):** El panel central debe mostrar los logs entrantes con un formato de terminal (fondo negro, texto verde/rojo), simulando la "lluvia de logs".
*   **RF6 (Gestión de Casos):** El analista puede cambiar el estado de un caso escalado a "Contenido" o "Falso Positivo", lo que resta presión al sistema y sube la salud del SOC.

## 5. Criterios de Aceptación (CA)
*   **CA1 (Lluvia de Logs):** Dado un script que envía 50 logs por segundo, cuando el sistema los procesa, entonces el panel central muestra los logs fluyendo sin trabar la interfaz.
*   **CA2 (Filtro de Agentes):** Dado un log de "Login fallido", cuando es procesado por el Agente de Identidad, entonces NO se envía al panel del humano (se resuelve automáticamente).
*   **CA3 (Escalado e IA):** Dado un log de "Ejecución de PowerShell", cuando el Agente de Endpoint lo detecta, entonces aparece en el panel derecho con un resumen generado por Workers AI.
*   **CA4 (Salud Dinámica):** Dado un ataque masivo (3 casos críticos sin atender), cuando el analista mira la barra superior, entonces el estado del sistema se muestra en Rojo (20%).
*   **CA5 (Contención):** Dado un caso escalado, cuando el analista presiona "Aprobar Contención", entonces el caso pasa a "Resuelto" y la barra de salud sube en tiempo real.

## 6. UI/UX (Principios Rectores)
*   **Modo oscuro (Dark Mode) operativo.**
*   **Semáforo de Severidad:** Crítica (Rojo), Alta (Naranja), Media (Ámbar), Baja (Verde).
*   **Barra Superior (Salud del Sistema):** Un indicador visual grande y claro (Verde > 80%, Amarillo 50-80%, Rojo < 50%).
*   **Consola de Logs:** Tipografía monoespaciada (`JetBrains Mono` o similar), colores resaltados para ataques.
*   **Human-in-the-loop:** Las acciones del panel derecho siempre piden confirmación.

## 7. Métricas de Éxito
*   Tiempo de respuesta del Worker < 500 ms por log.
*   Tiempo de generación de resumen IA < 3 segundos.
*   Reducción de la carga del analista: 95% de los logs son filtrados por los agentes, solo el 5% llega al humano.
