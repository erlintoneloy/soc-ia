# Tests — SOC-IA

Herramientas de prueba del Worker (Cloudflare Workers + D1 + Workers AI).
No requieren dependencias adicionales: usan Node ≥ 18 (`fetch` y `node:test` nativos).

## 1. Preparar la D1 local (una sola vez)

Desde la raíz del repositorio:

```powershell
cd worker
npx wrangler d1 execute soc-ia-db --local --file=schema.sql
npx wrangler d1 execute soc-ia-db --local --file=seed.sql
```

O con los scripts del `package.json`:

```powershell
npm run db:init
```

> `seed.sql` es idempotente (`INSERT OR IGNORE`), así que `npm run db:init` se
> puede repetir sin errores. El Worker además autorrepara las filas de
> `agentes_estado` si faltan.

## 2. Levantar el Worker

```powershell
cd worker
npx wrangler dev
```

Queda escuchando en `http://127.0.0.1:8787`.

> `wrangler.toml` declara `[ai] remote = true`, así que el camino de escalado
> hace una inferencia real de Workers AI. Si no estás autenticado con
> `npx wrangler login`, el Worker cae en su fallback y el smoke test sigue
> pasando.

## 3. Smoke test

En otra terminal, desde la raíz:

```powershell
npm run test:smoke
```

El test verifica:

| Prueba | Endpoint |
|---|---|
| Health check con D1 conectada | `GET /api/health` |
| Log de ruido descartado y métricas del agente actualizadas | `POST /api/stream` |
| Fuerza bruta escalada como `alta`, agente en `alerta` | `POST /api/stream` + `GET /api/dashboard` |
| PowerShell ofuscado escalado como `critica` | `POST /api/stream` |
| Salud según `100 - 20·críticas - 10·altas` | `GET /api/dashboard` |
| Resolución del caso con `nuevo_estado` y `salud_sistema` | `PATCH /api/cases/:id` |
| Estado de resolución inválido → 400 `VALIDACION` | `PATCH /api/cases/:id` |
| Caso inexistente → 404 `NO_ENCONTRADO` | `PATCH /api/cases/:id` |
| Ruta de API desconocida → 404 JSON | `GET /api/ruta-inexistente` |
| Lote con logs inválidos → 400 `VALIDACION` | `POST /api/stream` |

Cada corrida usa un `RUN_ID` aleatorio para no chocar con casos previos y
marca sus casos como `falso_positivo` al finalizar.

### Contrato de errores

Todas las respuestas de error respetan la misma forma:

```json
{ "ok": false, "error": "descripción legible", "code": "VALIDACION" }
```

| Código | HTTP | Cuándo |
|---|---|---|
| `JSON_INVALIDO` | 400 | El cuerpo no es JSON válido |
| `VALIDACION` | 400 | Campo inválido, lote vacío, estado no permitido |
| `NO_ENCONTRADO` | 404 | Ruta de API o caso inexistente |
| `ERROR_INTERNO` | 500 | Fallo no controlado |

Para rutas que no son de API, el Worker responde una página HTML 404 con el
tema del SOC. En Cloudflare Pages, `frontend/404.html` cumple la misma función
para el sitio estático.

Si el Worker no está arriba, el test aborta con un mensaje que indica cómo
levantarlo.

## 4. Simulador de logs

```powershell
# Mezcla de ruido y ataques (75% / 25%), 20 logs a 10 por segundo
npm run sim

# Escenario específico
npm run sim -- --scenario fuerza-bruta --logs 50 --rate 20

# Ver los logs sin enviarlos
npm run sim -- --scenario mixto --logs 10 --dry-run

# Contra otra URL
npm run sim -- --url https://soc-ia-worker.tu-subdominio.workers.dev
```

Escenarios disponibles: `mixto`, `ruido`, `fuerza-bruta`, `escaneo`, `powershell`.

Opciones completas: `npm run sim -- --help`.

## 5. Limpiar el estado local

Detén `wrangler dev` antes de borrar el estado (Windows bloquea los archivos):

```powershell
npm run db:reset
npm run db:init
```

`db:reset` elimina `worker/.wrangler/state`, incluida la base D1 local.
