import { systemPool } from "@/server/db"
import { LEGACY_TENANT_ID, isValidTenantId } from "./identity"

/**
 * Aserción de arranque (§4.3): si el rol de BD de la app es dueño/superuser
 * o RLS no está habilitado, el aislamiento se omite EN SILENCIO. Este check
 * lo vuelve RUIDOSO en los logs al inicio (tenant.rls_not_effective) — el
 * panel sigue arrancando (el fallo jamás impide servir), pero la alerta es
 * la señal de despliegue roto.
 */
export async function assertTenantRlsEffective(): Promise<void> {
  try {
    // Rol actual de la conexión: dueño de tablas o superuser ⇒ RLS inútil.
    const role = await systemPool.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
    )
    if (role.rows[0]?.rolsuper === true) {
      logRlsError("el rol de BD de la app es superuser")
      return
    }

    // Muestreo de tablas críticas: RLS habilitado y sin política = filtra a
    // nadie (o a todos) silenciosamente.
    const tables = ["users", "sessions", "payment_orders", "mp_orders", "notes"]
    for (const table of tables) {
      const rel = await systemPool.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = $1",
        [table]
      )
      if (rel.rows[0]?.relrowsecurity !== true) {
        logRlsError(`RLS no habilitado en ${table}`)
        return
      }
    }

    // El rol no debe ser dueño de las tablas (owner bypass).
    const ownership = await systemPool.query<{ role: string; owned: string }>(
      `SELECT current_user AS role, tablename AS owned
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('users','payment_orders')
          AND tableowner = current_user
        LIMIT 1`
    )
    if (ownership.rowCount && ownership.rows[0]?.owned) {
      logRlsError(
        `el rol ${String(ownership.rows[0].role)} es dueño de tablas (${String(ownership.rows[0].owned)})`
      )
      return
    }

    // Sanity del tenant legado (la migración debe haber corrido).
    const legacy = await systemPool.query<{ slug: string }>(
      "SELECT slug FROM tenants WHERE id = $1",
      [LEGACY_TENANT_ID]
    )
    if (!legacy.rowCount || !isValidTenantId(LEGACY_TENANT_ID)) {
      logRlsError("el tenant legado tvbox no existe (correr db/apply-tenants.mjs)")
      return
    }

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "tenant.rls_effective",
        legacy_tenant_id: LEGACY_TENANT_ID,
        strict: (process.env.TENANT_STRICT || "off") === "on",
      })
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `tenant: rls_assertion_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }
}

function logRlsError(reason: string): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `tenant.rls_not_effective: ${reason} — el aislamiento por RLS NO es efectivo; revisar el rol de BD de la app (speilink_app) y db/apply-tenants.mjs`,
    })
  )
}

/**
 * Siembra del número de WhatsApp del legado (una sola vez): el env tomaba el
 * número de WHATSAPP_AGENT_NUMBER; en el modelo por tenant vive en
 * tenants.whatsapp_number. No pisa un valor ya fijado (Fase 4 lo gestiona).
 */
export async function seedLegacyWhatsAppNumber(): Promise<void> {
  const number = (process.env.WHATSAPP_AGENT_NUMBER || "").trim()
  if (!number) return
  try {
    await systemPool.query(
      `UPDATE tenants SET whatsapp_number = $2, updated_at = now()
        WHERE id = $1 AND whatsapp_number IS NULL`,
      [LEGACY_TENANT_ID, number]
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `tenant: seed_whatsapp_number_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }
}
