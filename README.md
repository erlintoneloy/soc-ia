# SOC-IA — Flota de Agentes

Dashboard de un SOC que filtra la lluvia de logs con tres agentes (Red, Identidad y Endpoint).
Solo los casos que los agentes no pueden contener llegan al analista humano, con un resumen y
una recomendación generados por Workers AI.

## En producción

| Recurso | URL |
|---|---|
| Dashboard | https://soc-ia.hackaton.workers.dev |
| Worker (API) | https://soc-ia-worker.hackaton.workers.dev |
| Health check | https://soc-ia-worker.hackaton.workers.dev/api/health |

El frontend apunta al Worker mediante `window.SOC_API_URL` (definido en `frontend/index.html`
solo para hosts distintos de `localhost`).

## Stack

- **Backend:** Cloudflare Workers (ES Modules).
- **Base de datos:** Cloudflare D1 (SQLite serverless).
- **IA:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`) con fallback.
- **Frontend:** Vanilla JS servido como assets estáticos de Workers.

## Desarrollo local

```powershell
npm install
npm run db:init                      # schema + seed en la D1 local
cd worker; npx wrangler dev          # API en http://127.0.0.1:8787
```

Abrir `frontend/index.html` (o servirlo con cualquier servidor estático). En `localhost`
el dashboard usa `http://127.0.0.1:8787/api`.

```powershell
npm run test:smoke                   # 10 pruebas end-to-end contra el Worker local
npm run sim -- --scenario mixto --logs 20 --rate 10
```

Detalles de las pruebas en [`tests/README.md`](tests/README.md).

## Despliegue

```powershell
npm run db:init:remote      # schema + seed en la D1 remota (idempotente)
npm run deploy:worker       # Worker https://soc-ia-worker.<subdominio>.workers.dev
npm run deploy              # frontend https://soc-ia.<subdominio>.workers.dev
```

El proyecto de frontend está configurado en `wrangler.jsonc` (`assets.directory: frontend`),
con `404.html` como página de error. El Worker vive en `worker/` con su propio `wrangler.toml`.

Smoke test contra producción:

```powershell
$env:SOC_IA_URL='https://soc-ia-worker.hackaton.workers.dev'
npm run test:smoke
```

## Documentación

- [`docs/PRD.md`](docs/PRD.md) — producto y alcance.
- [`docs/SPEC.md`](docs/SPEC.md) — modelo de datos, contratos y reglas.
- [`docs/ADR.md`](docs/ADR.md) — decisiones de arquitectura.
- [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) — estándares de trabajo.
