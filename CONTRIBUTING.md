# Guía de contribución

## Stack y estructura

- **Backend:** Cloudflare Workers + D1 + Workers AI.
- **Frontend:** Vanilla JS servido como assets del mismo Worker.
- **Configuración:** `wrangler.jsonc` (raíz) une assets, API, D1 y AI.

```
worker/src/    Worker: rutas, motor, auth, auditoría
frontend/      Dashboard (HTML/CSS/JS)
tests/unit/    Pruebas del motor (sin Worker)
tests/         Simulador y smoke tests end-to-end
docs/          PRD, SPEC, ADR, demo, checklist, consola de ataque
```

## Entorno local

```powershell
npm install
Copy-Item tests/.env.example tests/.env   # completar credenciales de demo
npm run db:init                           # schema + seed (o las migraciones pendientes)
npm run dev                               # dashboard + API en http://127.0.0.1:8787
```

```powershell
npm run test:unit      # motor de reglas, sin Worker
npm run test:smoke     # API end-to-end (requiere npm run dev)
```

> Las credenciales y secretos viven en `tests/.env` o `.dev.vars`, nunca en el repositorio.

## Ramas

- `main` es estable: **no se pushea directo**.
- Trabajar en `feat/<tema>`, `fix/<tema>` o `docs/<tema>`, siempre desde `main` actualizado.
- Abrir **Pull Request** hacia `main`, con revisión y CI en verde.
- Recomendado: proteger `main` con “require PR” y “require status checks”.

## Commits

Mensajes en español, atómicos y con el formato:

```
tipo(scope): descripción breve

- detalle de lo que cambia
```

Tipos: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`.

Ejemplos:

```
feat(api): agregar endpoint de auditoría por tenant
fix(ui): evitar que el modal se cierre al hacer foco
docs: actualizar el guion de demo
```

## Pull requests

- Describir **qué** cambia, **por qué** y **cómo probarlo**.
- Incluir captura para cambios de UI y evidencia de las pruebas.
- Mantener el PR enfocado; si mezcla dos funcionalidades, dividirlo.
- Actualizar la documentación afectada (`README`, `docs/`, `ADR`).
- No incluir secretos, tokens, datos personales ni archivos generados.

## Definition of Done

- [ ] Código limpio: nombres semánticos, sin código muerto ni `console.log` de depuración.
- [ ] Entradas validadas y errores uniformes: `{ "ok": false, "error": "...", "code": "..." }`.
- [ ] Si se agrega una consulta, **filtrar por `tenant_id`** (multi-tenant).
- [ ] Interfaz legible en escritorio y móvil.
- [ ] Pruebas: unitarias para lógica pura, smoke para endpoints.
- [ ] Documentación actualizada; ADR si es una decisión de arquitectura.
- [ ] Commit atómico en una rama propia, revisado antes de integrar.

## Reglas de seguridad

- Datos sintéticos: IPs de documentación (`203.0.113.x`, `198.51.100.x`) y usuarios ficticios.
- Nunca commitear `.env`, `.dev.vars`, tokens ni claves.
- Nunca incluir PII real en logs, pruebas ni prompts.
- No agregar capacidades ofensivas reales (escaneos, exploits, fuerza bruta contra servicios).
- Los endpoints nuevos heredan la sesión; los tokens de servicio deben ser de mínimo privilegio, revocables y auditados.

## Archivos compartidos

Para evitar conflictos entre ramas:

| Zona | Dueño / coordinación |
|---|---|
| `worker/`, `frontend/`, `tests/` | Cambios coordinados con el responsable del núcleo |
| `package.json`, `.github/`, `wrangler.jsonc`, `README.md` | Avisar antes de modificar |
| Directorios nuevos (ej. `attack-console/`) | Libres para el equipo de la funcionalidad |

## Documentación del proyecto

- [`docs/PRD.md`](docs/PRD.md) — producto y alcance.
- [`docs/SPEC.md`](docs/SPEC.md) — modelo de datos, contratos y reglas.
- [`docs/ADR.md`](docs/ADR.md) — decisiones de arquitectura.
- [`docs/DEMO.md`](docs/DEMO.md) — guion de demo.
- [`docs/CHECKLIST.md`](docs/CHECKLIST.md) — checklist previa a la demo.
- [`docs/ATTACK_CONSOLE.md`](docs/ATTACK_CONSOLE.md) — integración de la consola de ataque.
