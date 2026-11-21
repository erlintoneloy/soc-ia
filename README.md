# SOC-IA — Flota de Agentes

Dashboard de un SOC que filtra la lluvia de logs con tres agentes (Red, Identidad y Endpoint).
Solo los casos que los agentes no pueden contener llegan al analista humano, con un resumen y
una recomendación generados por Workers AI.

## En producción

| Recurso | URL |
|---|---|
| Dashboard + API | https://soc-ia.hackaton.workers.dev |
| Health check | https://soc-ia.hackaton.workers.dev/api/health |

El frontend y la API comparten origen: un solo Worker sirve los assets y las rutas `/api/*`.
La sesión se guarda en una cookie `HttpOnly`, por lo que no hay CORS.

### Credenciales de demo

| Rol | Email | Contraseña |
|---|---|---|
| Analista | `analista@soc-ia.demo` | `********` |
| Admin | `admin@soc-ia.demo` | `********` |

> Las contraseñas de las cuentas de demo se comparten fuera del repositorio y
> se cargan en `tests/.env` (ignorado por git). Copiá `tests/.env.example` a
> `tests/.env` y completá los valores. Son cuentas de demostración sin datos
> reales; no deben usarse en producción.

## Stack

- **Backend:** Cloudflare Workers (ES Modules).
- **Base de datos:** Cloudflare D1 (SQLite serverless).
- **IA:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`) con fallback.
- **Frontend:** Vanilla JS servido como assets estáticos del mismo Worker.

## Desarrollo local

```powershell
npm install
Copy-Item tests/.env.example tests/.env   # completar SOC_IA_PASSWORD y SOC_IA_ADMIN_PASSWORD
npm run db:init               # schema + seed en la D1 local
npm run dev                   # dashboard + API en http://127.0.0.1:8787
```

Abrir `http://127.0.0.1:8787` e ingresar con las credenciales de demo.

```powershell
npm run test:unit      # 7 pruebas del motor, sin Worker
npm run test:smoke     # 34 pruebas end-to-end (incluye autenticación)
npm run sim -- --scenario mixto --logs 20 --rate 10
```

> El simulador inicia sesión automáticamente con las credenciales de demo antes
> de enviar los lotes. Se pueden cambiar con `--email` / `--password`.
> Ver [`tests/README.md`](tests/README.md) para el flujo completo.

## Autenticación

- `POST /api/auth/login` → cookie `soc_sid` (HttpOnly, SameSite=Lax, 8 h).
- `POST /api/auth/logout` → invalida la sesión.
- `GET /api/auth/me` → usuario actual.
- PBKDF2-SHA256 con salt por usuario; en D1 solo se guarda el SHA-256 del token de sesión.
- Rate limit: 5 fallos por IP+email → bloqueo de 15 minutos.
- Todo `/api/*` exige sesión, salvo `/api/health` y el login.

## Protecciones operativas

- **Rate limit de API:** 30 ingresos por minuto por usuario en `POST /api/stream` y 60 en `PATCH /api/cases/:id`.
- **Deduplicación:** un mismo ataque (`fuente + tipo_evento + IP/usuario/host`) no crea otro caso durante 60 segundos. Se acumula en `ocurrencias` y la tarjeta muestra `×N`.
- **Tope de IA:** máximo 3 inferencias por lote. El resto de los casos se crea igual, pero con resumen de respaldo, marcado como `respaldo` en la UI.
- **Reset de demo:** botón visible solo para `admin` (o `POST /api/demo/reset`), que borra los casos, reinicia contadores y deja la salud en 100%.

## Detección con ventanas reales

El motor no confía en el campo `intentos` del cliente: cuenta eventos persistidos en `logs` por ventana de 60 s.

| Regla | Ventana | Disparo |
|---|---|---|
| Fuerza bruta | 60 s por usuario | 6 o más `login_fallido` |
| Auto-bloqueo de red | 60 s por IP de origen | más de 100 `request_normal` |
| Escaneo de puertos | inmediato | 1 evento |
| PowerShell ofuscado | inmediato | 1 evento |

- Los primeros 5 fallos de login quedan como `observado`; el sexto escala y los siguientes se deduplican contra el caso activo.
- Más de 100 requests del mismo origen se marcan como `bloqueado` (auto-contenido por el Agente de Red, sin intervención humana).
- Resultados por log: `escalado`, `observado`, `bloqueado`, `descartado` y `duplicado`.
- El motor está aislado en `worker/src/engine.js` (funciones puras) y tiene pruebas unitarias sin Worker.

## Contexto de activos

El inventario simula una organización ficticia (**Clínica Valle Verde**): 18 activos con hostname, IP, área, servicio y criticidad. Cada caso guarda el activo afectado, el usuario, la IP de origen y una evidencia acotada (máx. 500 caracteres).

- Los logs aceptan `host` (preferido) y `destino_ip` para identificar el activo, e `ip_origen` para el atacante.
- Si no hay coincidencia en el inventario, el caso se marca como **activo desconocido**.
- La prioridad combina severidad y criticidad del activo: **P1** (≥12), **P2** (≥6), **P3** (<6). Es independiente de la salud, que sigue la fórmula del SPEC.

### Usuarios de negocio

El seed incluye **9 usuarios ficticios** (`jefe.finanzas`, `bioq.lab`, `admin.ti`, etc.) con nombre, rol, área y equipo asignado. Cada caso se enlaza por `usuario_afectado` y la API devuelve `usuario_perfil`.

La tarjeta muestra `👤 Juan Pérez (Jefe de Finanzas)`, y el prompt de la IA recibe ese perfil para contextualizar la recomendación. Un usuario fuera del directorio se muestra con su identificador y sin perfil.

## Logs y consola en vivo

Cada log ingerido se persiste en D1 con su resultado: `escalado`, `descartado` o `duplicado`.

- La consola se alimenta de `GET /api/logs?after=<seq>&limit=100`, con cursor incremental y polling cada **1,5 s**. Todos los clientes ven los mismos eventos y el historial sobrevive a un refresh.
- Retención: se borran los logs de más de 24 h en una fracción de los requests.
- El reset de demo también limpia los logs.
- `GET /api/logs` exige sesión.

> Se eligió polling con cursor en lugar de SSE porque no requiere Durable Objects ni conexiones largas. La latencia máxima es de 1,5 s, suficiente para la demo; SSE/DO queda como mejora futura.

### Explorador de logs

El botón **🔎 Historial** abre un explorador con filtros sobre las últimas 24 h:

- Fuente, resultado, host, usuario, texto libre y rango de fechas.
- Tabla ordenada de más reciente a más antiguo, con paginación hacia atrás.
- Exportación **CSV** de hasta 1.000 filas con los filtros aplicados.

Parámetros de `GET /api/logs`:

| Parámetro | Uso |
|---|---|
| `after` | Cursor incremental para la consola en vivo |
| `before` | Cursor para páginas anteriores del historial |
| `sentido=desc` | Ordena de más reciente a más antiguo |
| `fuente`, `resultado` | Filtros exactos (`red`, `identidad`, `endpoint`; `escalado`, `descartado`, `duplicado`) |
| `host`, `usuario` | Búsqueda parcial, sin distinguir mayúsculas |
| `q` | Texto libre en evento, host, usuario e IPs |
| `desde`, `hasta` | Rango ISO-8601 |
| `format=csv` | Exporta el resultado filtrado |

## Despliegue

```powershell
npm run db:init:remote   # schema + seed en la D1 remota (idempotente)
npm run deploy           # assets + API en un solo Worker
```

> Si la base ya existía antes de la Fase 2, aplicá la migración una sola vez:
> `npm run db:migrate` (local) o `npm run db:migrate:remote` (remoto).
> Para el inventario de activos: `npm run db:migrate:activos` y
> `npm run db:migrate:activos:remote`.

El proyecto completo está configurado en `wrangler.jsonc` (`main`, `assets`, D1 y AI).
El código del Worker vive en `worker/` y el frontend en `frontend/`.

La integración continua (`.github/workflows/ci.yml`) corre las pruebas unitarias del
motor y el chequeo de sintaxis en cada push a `main` y en cada pull request.

Smoke test contra producción:

```powershell
$env:SOC_IA_URL='https://soc-ia.hackaton.workers.dev'
npm run test:smoke
```

## Documentación

- [`docs/PRD.md`](docs/PRD.md) — producto y alcance.
- [`docs/SPEC.md`](docs/SPEC.md) — modelo de datos, contratos y reglas.
- [`docs/ADR.md`](docs/ADR.md) — decisiones de arquitectura.
- [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) — estándares de trabajo.
