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

> `seed.sql` inserta los 3 agentes y **no es idempotente**. Si ya lo aplicaste,
> la segunda ejecución falla con `UNIQUE constraint failed`. En ese caso usa
> `npm run db:reset` y vuelve a ejecutar `npm run db:init`.

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
| Log de ruido descartado sin escalar | `POST /api/stream` |
| Fuerza bruta escalada y caso creado | `POST /api/stream` + `GET /api/dashboard` |
| Contrato del dashboard y rango de salud | `GET /api/dashboard` |
| Resolución del caso por el analista | `PATCH /api/cases/:id` |

Cada corrida usa un `RUN_ID` aleatorio para no chocar con casos previos y
marca su caso como `falso_positivo` al finalizar.

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
