/**
 * Registro de auditoría de acciones del sistema.
 * Un fallo al auditar no debe romper la acción principal.
 */

export async function registrarAuditoria(
  env,
  { tenantId, usuarioId = null, email = null, rol = null, accion, detalle = null, request = null }
) {
  const ip = request?.headers?.get('CF-Connecting-IP') || 'local';

  try {
    await env.DB.prepare(
      `INSERT INTO auditoria (id, tenant_id, usuario_id, usuario_email, rol, accion, detalle_json, ip, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        tenantId,
        usuarioId,
        email,
        rol,
        accion,
        detalle ? JSON.stringify(detalle).slice(0, 1000) : null,
        ip,
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.warn(`[SOC-IA] No se pudo registrar la auditoría (${accion}): ${error.message}`);
  }
}
