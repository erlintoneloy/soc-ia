# Guion de demo — SOC-IA

Duración estimada: **6-8 minutos**. Dos organizaciones ficticias: **Clínica Valle Verde**
(hospital) y **Banco Litoral**.

## Antes de empezar

- Dashboard: <https://soc-ia.hackaton.workers.dev>
- Credenciales: están en `tests/.env` (`SOC_IA_*`). No se publican en el repositorio.
- Dejar ambos tenants limpios con el botón **Reiniciar demo** (admin) o con el suite.
- Abrir dos ventanas: una normal para el hospital y una de incógnito para el banco.
- Tener una terminal en la raíz del repo para el escenario de flood.

## 1. Entrar como hospital (1 min)

1. Login con `analista@soc-ia.demo`.
2. Señalar en la barra superior el chip **Clínica Valle Verde**.
3. Estado inicial: salud 100%, tres agentes en `activo`, gráficos vacíos.

> "El SOC no espera al humano: los agentes filtran la lluvia y solo escalan lo que no pueden contener."

## 2. Simular la lluvia de logs (2 min)

1. Clic en **⚡ Simular Lluvia de Logs**.
2. Explicar lo que ocurre:
   - 8 intentos de login fallidos contra `WS-FAC-05` (Facturación): los primeros 5 quedan
     `observado`, el sexto escala y los siguientes se deduplican → **un caso con ×3**.
   - PowerShell ofuscado en `SRV-HIS-01` (historia clínica, crítica): **P1**.
   - Escaneo de puertos al firewall `FW-PERIMETRO-01`: **P1**.
   - Un login exitoso legítimo: `descartado`.
3. Mostrar la salud bajando a **60%**, los agentes en `alerta` y los tres casos.
4. Abrir una tarjeta y señalar: activo, área, servicio, criticidad, usuario afectado
   (Juan Pérez), prioridad y resumen de la IA.

> "La IA no decide: explica y recomienda. El humano aprueba la contención."

## 3. Explorador de logs (1 min)

1. Clic en **🔎 Historial**.
2. Filtrar `Host: SRV-HIS` → resultado `escalado`.
3. Mostrar los resultados por color: `observado`, `escalado`, `duplicado`, `descartado`.
4. Exportar **CSV**.

> "Cada log queda persistido con su resultado: trazabilidad real, no una animación del navegador."

## 4. Contención (1 min)

1. **Aprobar Contención** del caso de PowerShell.
2. La salud sube y el agente vuelve a `activo`.

> "Human-in-the-loop: la acción destructiva siempre la confirma el analista."

## 5. Ventanas y auto-bloqueo (1 min)

1. Volver a simular dentro de los 60 s: los ataques repetidos muestran **×N**, sin casos nuevos.
2. En la terminal:

   ```powershell
   npm run sim -- --scenario flood --logs 150
   ```

3. En el explorador filtrar `Resultado: bloqueado`: **50 logs auto-contenidos** por el Agente de Red,
   sin intervención humana.

> "Detección stateful con ventanas de 60 s: el motor cuenta eventos persistidos, no confía en el
> campo `intentos` del cliente."

## 6. Multi-tenant (1-2 min)

1. En la ventana de incógnito, login con `analista@banco-litoral.demo`.
2. Señalar el chip **Banco Litoral** y el dashboard vacío: **no ve nada del hospital**.
3. Simular: los casos usan `WS-CAJA-05`, `SRV-CORE-01` y `FW-BANCO-01`.
4. Volver a la ventana del hospital: los casos del banco **no aparecen**.
5. Intentar abrir la URL de un caso del banco desde el hospital: responde 404.

> "Aislamiento por tenant: cada organización ve solo sus datos, sus agentes y su salud."

## 7. Cierre (30 s)

- Reset de demo con el admin de cada tenant.
- Puntos para cerrar:
  - Reglas deterministas + ventanas de 60 s.
  - IA solo para explicar y recomendar, con fallback marcado.
  - Human-in-the-loop.
  - Autenticación por sesión, rate limit y multi-tenant.
  - Tests unitarios + smoke end-to-end.

## Contingencias

- **IA caída o cuota agotada:** los casos se crean igual y muestran la etiqueta `respaldo`.
- **Rate limit:** esperar un minuto; el límite es 30 ingestas por minuto por usuario.
- **Deploy recién hecho:** esperar ~30 s a la propagación del Worker.
- **"Sin conexión" en la barra:** revisar la pestaña Network; el dashboard y la API comparten origen.
- **El botón no responde:** verificar la consola del navegador (F12); el botón se rehabilita al terminar.
