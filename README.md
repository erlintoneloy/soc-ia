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
npm run test:smoke     # 23 pruebas end-to-end (incluye autenticación)
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

## Despliegue

```powershell
npm run db:init:remote   # schema + seed en la D1 remota (idempotente)
npm run deploy           # assets + API en un solo Worker
```

> Si la base ya existía antes de la Fase 2, aplicá la migración una sola vez:
> `npm run db:migrate` (local) o `npm run db:migrate:remote` (remoto).

El proyecto completo está configurado en `wrangler.jsonc` (`main`, `assets`, D1 y AI).
El código del Worker vive en `worker/` y el frontend en `frontend/`.

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
