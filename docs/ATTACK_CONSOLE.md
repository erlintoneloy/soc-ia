# Consola de adversario simulado — guion de integración

Aplicación **aparte** que genera ataques sintéticos contra SOC-IA y muestra el resultado de la
ingesta. No hace escaneos ni explotación real: es un generador de eventos con estética de atacante.

## 1. Alcance

- Directorio de trabajo: **`attack-console/`** (nuevo).
- **No tocar** `worker/`, `frontend/`, `tests/`, `package.json` raíz ni `ci.yml` sin coordinarlo.
- Entrada: `POST /api/simulate` con un token por tenant.
- Salida esperada: una app web con selector de tenant, escenarios, intensidad, feed y contadores.

## 2. Autenticación: tokens de simulación

El endpoint `/api/stream` usa cookie de sesión y no sirve para una app en otro origen. Para eso
existe `/api/simulate`, autenticado con un **token por tenant**:

1. Un admin del tenant crea el token (una sola vez muestra el valor):

   ```bash
   # 1) Login del admin (usar la clave de tests/.env; no versionarla)
   curl -c cookies.txt -X POST https://soc-ia.hackaton.workers.dev/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@banco-litoral.demo","password":"<clave>"}'

   # 2) Crear token para ese tenant
   curl -b cookies.txt -X POST https://soc-ia.hackaton.workers.dev/api/admin/tokens \
     -H "Content-Type: application/json" \
     -d '{"nombre":"consola-ataque"}'
   ```

   La respuesta incluye `{ id, nombre, token }`. El `token` empieza con `socsim_` y **no se vuelve
   a mostrar**. Guardalo en un lugar seguro.

2. Listar y revocar (admin):

   ```bash
   curl -b cookies.txt https://soc-ia.hackaton.workers.dev/api/admin/tokens
   curl -b cookies.txt -X DELETE https://soc-ia.hackaton.workers.dev/api/admin/tokens/<id>
   ```

3. La app envía el token en cada request:

   ```
   Authorization: Bearer socsim_xxxxxxxxx
   ```

El token identifica el tenant: no hace falta mandar `tenant` en el body. Es de **solo ingesta**:
no puede leer dashboard, casos ni logs. Se guarda hasheado, se puede revocar y tiene rate limit propio.

## 3. Contrato de `POST /api/simulate`

**Request**

```
POST /api/simulate
Authorization: Bearer socsim_...
Content-Type: application/json

{ "logs": [ { ... }, ... ] }
```

- Máximo **100 logs** por request.
- CORS habilitado (`Access-Control-Allow-Origin: *`) porque la app vive en otro origen.
- No usa cookies.

**Log**

```json
{
  "fuente": "endpoint",
  "tipo_evento": "powershell_encoded",
  "host": "SRV-HIS-01",
  "destino_ip": "10.20.80.11",
  "ip_origen": "203.0.113.50",
  "usuario": "admin.ti",
  "payload": "powershell.exe -enc ..."
}
```

`fuente` y `tipo_evento` son obligatorios. `host`/`destino_ip` identifican el activo afectado;
`ip_origen` es el atacante.

**Response**

```json
{
  "ok": true,
  "data": {
    "procesados": 6,
    "escalados": 1,
    "descartados": 0,
    "observados": 5,
    "bloqueados": 0,
    "casos_creados": 1,
    "duplicados": 0
  }
}
```

**Errores**

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDACION` / `JSON_INVALIDO` | Lote inválido o vacío, más de 100 logs |
| 401 | `TOKEN_INVALIDO` | Falta el token o está revocado |
| 429 | `DEMASIADAS_PETICIONES` | Más de 30 requests por minuto por token |
| 500 | `ERROR_INTERNO` | Fallo no controlado |

## 4. Reglas que hacen que el SOC detecte

| Escenario | Para que escale |
|---|---|
| Fuerza bruta | 6 o más `identidad/login_fallido` con el mismo `usuario` en 60 s |
| Flood de red | 101 o más `red/request_normal` con la misma `ip_origen` en 60 s → `bloqueado` |
| Escaneo | 1 `red/escaneo_puertos` |
| PowerShell | 1 `endpoint/powershell_encoded` |

- Los primeros 5 logins quedan `observado`; el sexto escala.
- El mismo ataque repetido en 60 s no crea otro caso: incrementa `ocurrencias` (`×N`).
- La IA resume como máximo 3 casos por lote; el resto usa respaldo.

## 5. Activos y usuarios de ejemplo

**Clínica Valle Verde** (`clinica-valle-verde`)

- `WS-FAC-05` (10.20.50.5) — jefe.finanzas — Facturación.
- `SRV-HIS-01` (10.20.80.11) — admin.ti — historia clínica, crítica.
- `FW-PERIMETRO-01` (10.20.80.1) — perímetro, crítica.

**Banco Litoral** (`banco-litoral`)

- `WS-CAJA-05` (10.30.20.5) — cajero.01 — sucursal.
- `SRV-CORE-01` (10.30.80.11) — admin.banco — core bancario, crítica.
- `FW-BANCO-01` (10.30.80.1) — perímetro, crítica.

## 6. Requisitos de la app

- Selector de tenant (cada uno con su token).
- Botones por escenario: fuerza bruta, escaneo, PowerShell, flood, activo desconocido.
- Control de intensidad (cantidad de logs y pausa entre lotes).
- Feed de "ataque" con la respuesta del SOC.
- Contadores: procesados, escalados, casos nuevos, bloqueados, duplicados.
- Botón **Detener** y manejo visible de 401/429.
- Tema oscuro, responsive, sin frameworks pesados.
- No mostrar el token en pantalla ni en logs.

## 7. Flujo de Git

```bash
git checkout main
git pull
git checkout -b feat/consola-ataque

# desarrollo
git add attack-console docs/ATTACK_CONSOLE.md   # solo si hace falta tocar este doc
git commit -m "feat(attack): agregar consola de adversario simulado"

git push -u origin feat/consola-ataque
```

- **No pushear a `main`**: abrir PR.
- Commits atómicos en español (`feat(attack):`, `fix(attack):`, `docs(attack):`).
- PR con descripción, captura y evidencia de una corrida.
- Antes de pushear: `npm run test:unit` y, si agrega tests propios, correrlos.
- No commitear `.env`, tokens ni claves.

## 8. Criterio de aceptación

- [ ] La app corre y despliega con una URL propia.
- [ ] Genera los 5 escenarios con un token por tenant.
- [ ] Muestra la respuesta de `/api/simulate` y maneja 401/429.
- [ ] No contiene secretos ni datos reales.
- [ ] README con cómo correrla y crear el token.
- [ ] Captura de una corrida con casos creados y bloqueados.
- [ ] Las simulaciones aparecen en la auditoría del admin (acción `simulacion`).

## 9. Seguridad

- Solo datos sintéticos; IPs de documentación (`203.0.113.x`, `198.51.100.x`).
- **No** implementar escaneos, fuerza bruta contra servicios ni exploits reales.
- El token es de ingesta y por tenant; no reutilizar credenciales de analista.
- No loggear el token; pedirlo una vez y guardarlo en el almacenamiento del navegador con una
  advertencia.
