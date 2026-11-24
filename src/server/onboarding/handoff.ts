import { createHash, randomBytes } from "node:crypto"

import { pool, systemPool } from "@/server/db"
import { runAsPlatform, runWithTenant } from "@/server/tenant/context"

/**
 * Ticket de entrega de sesión del registro público (Fase 1, §4.2 del plan):
 * el alta crea el negocio en el apex y redirige a
 * `https://<slug>.spei.link/onboarding/continuar?ticket=<token>` para ENTREGAR
 * la sesión en el subdominio sin volver a pedir la contraseña.
 *
 * - Solo se guarda el sha256 del token (el claro viaja en la URL y queda en
 *   historial): un solo uso, 10 minutos, canje atómico.
 * - La tabla lleva RLS por tenant: la petición de canje llega anónima al host
 *   del tenant y solo puede ver tickets de ESE tenant (la cookie del apex no
 *   sirve fuera de él).
 */

const HANDOFF_TTL_MS = 10 * 60 * 1000
/** Ventana de limpieza perezosa (una vez por hora de proceso). */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export function hashHandoffToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export interface SignupHandoff {
  token: string
  expiresAt: Date
}

/**
 * Crea el ticket para el propietario recién dado de alta. Corre bajo el
 * contexto del tenant nuevo (el trigger rellena tenant_id y RLS pasa).
 */
export async function createSignupHandoff(
  tenantId: string,
  userId: string
): Promise<SignupHandoff> {
  scheduleHandoffCleanup()
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS)
  await runWithTenant(tenantId, () =>
    pool.query(
      `INSERT INTO signup_handoffs (id, tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), tenantId, userId, hashHandoffToken(token), expiresAt]
    )
  )
  return { token, expiresAt }
}

export interface RedeemedHandoff {
  userId: string
  tenantId: string
}

/**
 * Canje atómico de un solo uso: la petición corre en el host del tenant, así
 * que RLS acota la búsqueda a los tickets de ESE tenant (un ticket abierto en
 * otro subdominio no existe aquí). Devuelve null si el ticket es desconocido,
 * vencido o ya usado.
 */
export async function redeemSignupHandoff(
  token: string
): Promise<RedeemedHandoff | null> {
  const result = await pool.query<{
    user_id: string
    tenant_id: string
  }>(
    `UPDATE signup_handoffs
        SET used_at = now()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING user_id, tenant_id`,
    [hashHandoffToken(token)]
  )
  const row = result.rows[0]
  if (!row) return null
  return { userId: row.user_id, tenantId: row.tenant_id }
}

// ---------------------------------------------------------------------------
// Limpieza perezosa (best-effort): borra tickets consumidos/vencidos viejos.
// Corre bajo plataforma (lista de trabajo cross-tenant) a lo sumo una vez
// por hora de proceso; un fallo jamás rompe el alta.
// ---------------------------------------------------------------------------

let lastCleanupAt = 0

function scheduleHandoffCleanup(): void {
  const now = Date.now()
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now
  void runAsPlatform(async () => {
    try {
      await systemPool.query(
        `DELETE FROM signup_handoffs
          WHERE expires_at < now() - interval '24 hours'
             OR (used_at IS NOT NULL AND used_at < now() - interval '24 hours')`
      )
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `onboarding: handoff_cleanup_failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  })
}
