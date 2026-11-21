# Tests — SOC-IA

Herramientas de prueba del Worker (Cloudflare Workers + D1 + Workers AI).
No requieren dependencias adicionales: usan Node ≥ 18 (`fetch` y `node:test` nativos).

## 1. Preparar la D1 local

Desde la raíz del repositorio:

```powershell
npm run db:init
```

Crea las tablas (incluidas `usuarios`, `sesiones` e `intentos_login`) y siembra los
agentes, la salud inicial y los usuarios de demo. Es idempotente (`INSERT OR IGNORE`).

> Si ya tenías un estado local viejo, `npm run db:reset` lo borra y después
> volvés a ejecutar `npm run db:init`. Si la base existía antes de la Fase 2,
> aplicá `npm run db:migrate` una sola vez.

## 2. Levantar el Worker

```powershell
npm run dev
```

Un solo proceso sirve el dashboard y la API en `http://127.0.0.1:8787`.

> `wrangler.jsonc` declara `[ai] remote = true`, así que el camino de escalado
> hace una inferencia real de Workers AI. Si no estás autenticado con
> `npx wrangler login`, el Worker cae en su fallback y el smoke test sigue
> pasando.

## 3. Credenciales de demo

| Rol | Email | Contraseña |
|---|---|---|
| Analista | `analista@soc-ia.demo` | `SocIA2026!` |
| Admin | `admin@soc-ia.demo` | `AdminSocIA2026!` |

## 4. Smoke test

```powershell
npm run test:smoke
```

El suite hace login al inicio y maneja la cookie de sesión manualmente
(Node `fetch` no guarda cookies). Verifica:

| Prueba | Endpoint |
|---|---|
| Health check con D1 conectada (público) | `GET /api/health` |
| Dashboard sin sesión → 401 | `GET /api/dashboard` |
| Ingesta sin sesión → 401 | `POST /api/stream` |
| Credenciales incorrectas → 401 genérico | `POST /api/auth/login` |
| Login correcto, cookie y usuario actual | `POST /api/auth/login` + `GET /api/auth/me` |
| 5 intentos fallidos → 429 | `POST /api/auth/login` |
| Cookie inválida → 401 | `GET /api/auth/me` |
| Log de ruido descartado y métricas | `POST /api/stream` |
| Fuerza bruta escalada como `alta` | `POST /api/stream` |
| El mismo ataque no duplica caso en 60 s | `POST /api/stream` |
| PowerShell ofuscado como `critica` | `POST /api/stream` |
| Tope de 3 inferencias por lote con respaldo | `POST /api/stream` |
| Métricas consistentes para los gráficos | `GET /api/dashboard` |
| Salud según `100 - 20·críticas - 10·altas` | `GET /api/dashboard` |
| Resolución con `nuevo_estado` y salud | `PATCH /api/cases/:id` |
| Estado inválido → 400 | `PATCH /api/cases/:id` |
| Caso inexistente → 404 | `PATCH /api/cases/:id` |
| Ruta de API desconocida → 404 | `GET /api/ruta-inexistente` |
| Lote con logs inválidos → 400 | `POST /api/stream` |
| Rate limit de 30 ingesta/min → 429 | `POST /api/stream` |
| Reset solo para admin → 403 | `POST /api/demo/reset` |
| Reset deja el SOC en 100% y sin casos | `POST /api/demo/reset` |
| Logout invalida la sesión | `POST /api/auth/logout` |

Cada corrida usa un `RUN_ID` aleatorio para no chocar con casos previos y
marca sus casos como `falso_positivo` al finalizar.

### Contrato de errores

```json
{ "ok": false, "error": "descripción legible", "code": "VALIDACION" }
```

| Código | HTTP | Cuándo |
|---|---|---|
| `JSON_INVALIDO` | 400 | El cuerpo no es JSON válido |
| `VALIDACION` | 400 | Campo inválido, lote vacío, estado no permitido |
| `CREDENCIALES` | 401 | Email o contraseña incorrectos |
| `NO_AUTENTICADO` | 401 | Falta la cookie o la sesión expiró |
| `ORIGEN_INVALIDO` | 403 | El `Origin` no coincide con el host |
| `PROHIBIDO` | 403 | La acción requiere rol admin |
| `NO_ENCONTRADO` | 404 | Ruta de API o caso inexistente |
| `DEMASIADOS_INTENTOS` | 429 | Rate limit de login excedido |
| `DEMASIADAS_PETICIONES` | 429 | Rate limit de ingesta o triage excedido |
| `ERROR_INTERNO` | 500 | Fallo no controlado |

Las rutas que no son de API sirven `frontend/404.html` como página de error.

## 5. Simulador de logs

El simulador hace login automáticamente con las credenciales de demo antes de
enviar los lotes. Se pueden cambiar con `--email` y `--password` o con las
variables `SOC_IA_EMAIL` / `SOC_IA_PASSWORD`.

```powershell
# Mezcla de ruido y ataques (75% / 25%), 20 logs a 10 por segundo
npm run sim

# Escenario específico
npm run sim -- --scenario fuerza-bruta --logs 50 --rate 20

# Ver los logs sin enviarlos ni autenticarse
npm run sim -- --scenario mixto --logs 10 --dry-run

# Contra producción
npm run sim -- --url https://soc-ia.hackaton.workers.dev
```

Escenarios disponibles: `mixto`, `ruido`, `fuerza-bruta`, `escaneo`, `powershell`.

Opciones completas: `npm run sim -- --help`.

> Un mismo ataque repetido dentro de 60 segundos no crea casos nuevos: se
> acumula en `ocurrencias` y el resumen indica cuántos duplicados hubo.

## 6. Limpiar el estado local

Detén `npm run dev` antes de borrar el estado (Windows bloquea los archivos):

```powershell
npm run db:reset
npm run db:init
```

`db:reset` elimina `.wrangler/state`, incluida la base D1 local.
