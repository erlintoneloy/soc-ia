# Checklist previa a la demo — SOC-IA

Marcar cada ítem antes de presentar. Tiempo estimado de preparación: **20-30 minutos**.

> Guion completo: [`DEMO.md`](DEMO.md). Consola de ataque: [`ATTACK_CONSOLE.md`](ATTACK_CONSOLE.md).

## 1. 24 horas antes

- [ ] `main` actualizado y desplegado (`npm run deploy`).
- [ ] Esperar ~30 s de propagación y abrir <https://soc-ia.hackaton.workers.dev>.
- [ ] Smoke test contra producción: **37/37**.
- [ ] Pruebas unitarias del motor: **7/7**.
- [ ] CI de GitHub Actions en verde.
- [ ] Migraciones aplicadas en la D1 remota (0001 a 0007).

## 2. Datos y tenants

- [ ] **Clínica Valle Verde**: 18 activos, 9 usuarios de negocio, salud 100%.
- [ ] **Banco Litoral**: 4 activos, 3 usuarios de negocio, salud 100%.
- [ ] Reset de demo con el admin de cada tenant (sin casos ni logs).
- [ ] El chip del topbar muestra la organización correcta en cada sesión.
- [ ] Los tres agentes aparecen en `activo` y la salud en 100%.

## 3. Credenciales

- [ ] `tests/.env` existe con las cuatro claves (`SOC_IA_PASSWORD`, `SOC_IA_ADMIN_PASSWORD`, `SOC_IA_PASSWORD_BANCO`, `SOC_IA_ADMIN_PASSWORD_BANCO`).
- [ ] Login probado con las cuatro cuentas: analista y admin de ambos tenants.
- [ ] Las claves están en un canal privado para la demo (no en pantalla compartida).
- [ ] Ninguna clave quedó commiteada (`git status` limpio).

## 4. Navegador

- [ ] Ventana normal → hospital; ventana de incógnito → banco.
- [ ] Zoom al 100%, resolución 1440×900 o superior.
- [ ] `Ctrl+F5` en ambas ventanas antes de empezar (evitar caché de JS/CSS).
- [ ] Consola del navegador cerrada y notificaciones silenciadas.
- [ ] El badge **● En línea** está en verde en las dos sesiones.
- [ ] El botón **Auditoría** aparece solo en las sesiones admin.

## 5. Terminal

- [ ] Repo en la raíz y `npm run test:unit` responde.
- [ ] Comando de flood listo:

  ```powershell
  npm run sim -- --scenario flood --logs 150
  ```

- [ ] Plan B si falla el botón web:

  ```powershell
  npm run sim -- --scenario mixto --logs 20
  ```

- [ ] Recordar que el CLI entra como **hospital**; para el banco usar `--email`/`--password` o el botón web.

## 6. Ensayo general

Correr el guion completo, cronometrado (6-8 minutos):

- [ ] Login hospital y estado inicial.
- [ ] Simulación: 8 logins (5 observados, 1 caso ×3), PowerShell P1, escaneo P1; salud **60%**.
- [ ] Explorador: filtros, resultados por color y exportación CSV.
- [ ] Contención: aparece el **modal de confirmación**; al confirmar sube la salud.
- [ ] Panel **Auditoría**: login, triage y reset visibles.
- [ ] Segunda simulación dentro de 60 s: dedupe con **×N**, sin casos nuevos.
- [ ] Flood: **50 bloqueados** y visibles en el explorador.
- [ ] Banco en incógnito: dashboard aislado, casos con activos del banco.
- [ ] El hospital no ve los casos del banco y el `PATCH` cruzado responde 404.
- [ ] Reset de ambos tenants al terminar.

## 7. Contingencias

- [ ] **IA caída o cuota:** los casos se crean igual y muestran la etiqueta `respaldo`.
- [ ] **Rate limit:** esperar 60 s; el límite es 30 ingestas por minuto por usuario.
- [ ] **Sesión vencida:** volver a loguearse; el login expira a las 8 h.
- [ ] **Página vieja o botón sin respuesta:** `Ctrl+F5` y revisar la consola (F12).
- [ ] **Deploy recién hecho:** esperar 30 s de propagación.
- [ ] **La web no responde:** usar el simulador por CLI como plan B.
- [ ] **Rollback:** `npx wrangler deployments list` y `npx wrangler rollback <id>` si el último deploy rompió algo.
- [ ] Capturas de respaldo de los estados clave guardadas fuera del repo.

## 8. Riesgos conocidos (para responder, no para ocultar)

- [ ] **Prompt injection:** el payload del log se incluye en el prompt de la IA; falta delimitar/sanear el input.
- [ ] **Evidencia completa:** la tarjeta y el explorador no muestran el `payload_json` crudo; falta una vista de detalle.
- [ ] **Ciclo de vida:** un caso ya resuelto se puede volver a resolver (200) en vez de 409; no hay asignación ni notas.
- [ ] **Aislamiento lógico:** multi-tenant por columna `tenant_id` en una sola D1, no aislamiento físico.
- [ ] **Disciplina de tenant:** cada consulta nueva debe filtrar por `tenant_id`; el test de aislamiento ayuda, pero es manual.
- [ ] **Auditoría best-effort:** si falla la escritura, la acción principal no se bloquea; no hay retención automática.
- [ ] **CI parcial:** corre unitarios y sintaxis, no el smoke end-to-end (necesita Worker, D1 y Workers AI).
- [ ] **Sin alertas externas:** no hay notificaciones por mail/Slack/webhook.

## 9. Cierre

- [ ] Reset de ambos tenants (salud 100%, sin casos).
- [ ] Logout en las dos ventanas.
- [ ] Servidor local detenido (`Ctrl+C`).
- [ ] Credenciales y tokens fuera de la pantalla compartida.
- [ ] `git status` limpio y `main` sincronizado.
