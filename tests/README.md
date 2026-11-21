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
> aplicá `npm run db:migrate` una sola vez. Para el inventario de activos:
> `npm run db:migrate:activos`. Para el directorio de usuarios:
> `npm run db:migrate:usuarios`. Para los logs de la Fase 4:
> `npm run db:migrate:logs`. Para multi-tenant:
> `npm run db:migrate:tenant`. Para auditoría y tokens:
> `npm run db:migrate:auditoria`.

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

Las contraseñas no se versionan. Copiá `tests/.env.example` a `tests/.env` y completá:

```dotenv
SOC_IA_PASSWORD=
SOC_IA_ADMIN_PASSWORD=
SOC_IA_PASSWORD_BANCO=
SOC_IA_ADMIN_PASSWORD_BANCO=
```

`npm run test:smoke` y `npm run sim` cargan ese archivo con
`--env-file-if-exists=tests/.env`. Se mantiene fuera de la raíz para que
`wrangler dev` no lo inyecte como variables del Worker.

Las cuentas son:

| Rol | Email |
|---|---|
| Analista (hospital) | `analista@soc-ia.demo` |
| Admin (hospital) | `admin@soc-ia.demo` |
| Analista (banco) | `analista@banco-litoral.demo` |
| Admin (banco) | `admin@banco-litoral.demo` |

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
| Fuerza bruta por debajo del umbral → observada | `POST /api/stream` |
| Fuerza bruta al sexto evento de 60 s → caso | `POST /api/stream` |
| El mismo ataque no duplica caso en 60 s | `POST /api/stream` |
| Inundación de más de 100 requests → bloqueada | `POST /api/stream` |
| PowerShell ofuscado como `critica` | `POST /api/stream` |
| Tope de 3 inferencias por lote con respaldo | `POST /api/stream` |
| Activo resuelto por IP cuando falta el host | `POST /api/stream` |
| Activo desconocido con prioridad media | `POST /api/stream` |
| Un caso por cada activo afectado | `POST /api/stream` |
| Perfil de usuario incluido en el caso | `GET /api/dashboard` |
| Usuario fuera del directorio → sin perfil | `POST /api/stream` |
| Logs sin sesión → 401 | `GET /api/logs` |
| Persistencia del log con su resultado | `POST /api/stream` + `GET /api/logs` |
| Cursor incremental de logs | `GET /api/logs` |
| El reset borra los logs | `POST /api/demo/reset` |
| Aislamiento de casos y logs entre tenants | `GET /api/dashboard` + `PATCH` |
| Auditoría solo para administradores | `GET /api/auditoria` |
| Token de simulación, ataque y revocación | `POST /api/admin/tokens` + `/api/simulate` |
| Filtros por fuente y resultado | `GET /api/logs?sentido=desc` |
| Filtros por host, usuario y texto libre | `GET /api/logs` |
| Paginación hacia atrás sin solaparse | `GET /api/logs?before=` |
| Exportación CSV filtrada | `GET /api/logs?format=csv` |
| Filtros inválidos → 400 | `GET /api/logs?fuente=` |
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
marca sus casos como `falso_positivo` al finalizar. Además, el suite **reinicia
la demo al inicio** (con la cuenta admin) para partir de un estado limpio y
evitar que datos de corridas anteriores rompan las aserciones.

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

### Simulación con token

`POST /api/simulate` permite que una app externa envíe logs con
`Authorization: Bearer socsim_...`. El token es por tenant, solo de ingesta,
revocable y con rate limit de 30/min. Se crea con `POST /api/admin/tokens`
(admin). El contrato completo está en `docs/ATTACK_CONSOLE.md`.

## 5. Pruebas unitarias del motor

No necesitan Worker ni D1: prueban las funciones puras de `worker/src/engine.js`.

```powershell
npm run test:unit
```

Cubren el reconocimiento de las tres reglas, la prioridad P1/P2/P3, los umbrales
de las ventanas (6 fallos y 101 requests) y la clave de deduplicación. La misma
suite corre en GitHub Actions en cada push a `main` y en cada pull request.

## 6. Simulador de logs

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

Escenarios disponibles: `mixto`, `ruido`, `fuerza-bruta`, `escaneo`, `powershell`, `desconocido`, `flood`.

- `fuerza-bruta` necesita al menos 6 logs para cruzar el umbral; con menos quedan `observado`.
- `flood` necesita más de 100 logs (`--logs 150`) para que el Agente de Red auto-bloquee.
- `mixto` con 8 o más logs arranca con 6 fallos de login, un escaneo y un PowerShell.

Opciones completas: `npm run sim -- --help`.

> Un mismo ataque repetido dentro de 60 segundos no crea casos nuevos: se
> acumula en `ocurrencias` y el resumen indica cuántos duplicados hubo.

## 7. Limpiar el estado local

Detén `npm run dev` antes de borrar el estado (Windows bloquea los archivos):

```powershell
npm run db:reset
npm run db:init
```

`db:reset` elimina `.wrangler/state`, incluida la base D1 local.
