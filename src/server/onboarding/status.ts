import { systemPool } from "@/server/db"
import { findTenantById, tenantIdOfUser } from "@/server/tenant/context"
import { homePathForUser } from "@/server/auth/types"

/**
 * Estado derivado del onboarding del negocio (Fase 1, §4.4 del plan): SIN
 * banderas guardadas — cada paso se deriva de los datos reales (tenants.bank_*,
 * tenant_mp_tokens y la sesión de WhatsApp). Cambiar el dato en Perfil o en el
 * módulo WhatsApp actualiza el estado al instante.
 */

export interface OnboardingStatus {
  name: string
  slug: string
  business: { done: boolean }
  mpToken: { done: boolean }
  whatsapp: { done: boolean }
  complete: boolean
}

/** Estado del onboarding del tenant; null si no existe o no es negocio. */
export async function getOnboardingStatus(
  tenantId: string
): Promise<OnboardingStatus | null> {
  const tenant = await findTenantById(tenantId)
  if (!tenant || tenant.kind !== "business") return null

  const businessDone =
    tenant.bankName !== null &&
    tenant.bankHolder !== null &&
    tenant.bankClabe !== null

  const mpDone = await mpTokenActive(tenantId)
  const whatsappDone =
    tenant.whatsappNumber !== null && tenant.whatsappLinkedAt !== null

  return {
    name: tenant.name,
    slug: tenant.slug,
    business: { done: businessDone },
    mpToken: { done: mpDone },
    whatsapp: { done: whatsappDone },
    complete: businessDone && mpDone && whatsappDone,
  }
}

/** Token activo del negocio (fuente de verdad: la fila, no una bandera). */
async function mpTokenActive(tenantId: string): Promise<boolean> {
  const result = await systemPool.query<{ status: string }>(
    `SELECT status FROM tenant_mp_tokens WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  )
  return result.rows[0]?.status === "active"
}

export const ONBOARDING_PATH = "/onboarding"

/**
 * Destino tras iniciar sesión (§6.9; reestructura de bloques 2026-11-24):
 * cuentas SIN tenant van a `/inicio` del host de plataforma (su shell de
 * cinco bloques); el propietario de un negocio CON onboarding incompleto
 * vuelve al asistente (sin rebote desde /clientes: «Saltar» tiene que
 * funcionar y el siguiente login vuelve a sugerirlo). El resto va a su
 * pantalla de inicio de siempre.
 */
export async function postLoginPathFor(userId: string): Promise<string> {
  try {
    const tenantId = await tenantIdOfUser(userId)
    if (!tenantId) {
      // Cuenta de plataforma o afiliado: el destino sale del PERFIL (el
      // shell del panel con todo vacío jamás les toca).
      const row = await systemPool.query<{ role: string }>(
        "SELECT role FROM users WHERE id = $1",
        [userId]
      )
      return homePathForUser({ role: row.rows[0]?.role ?? "" })
    }
    const tenant = await findTenantById(tenantId)
    if (!tenant || tenant.kind !== "business") return "/clientes"
    if (tenant.status !== "active") return "/clientes"
    if (tenant.bankName === null || tenant.bankHolder === null || tenant.bankClabe === null) {
      return ONBOARDING_PATH
    }
    const mpDone = await mpTokenActive(tenantId)
    if (!mpDone) return ONBOARDING_PATH
    const whatsappDone =
      tenant.whatsappNumber !== null && tenant.whatsappLinkedAt !== null
    if (!whatsappDone) return ONBOARDING_PATH
    return "/clientes"
  } catch {
    return "/clientes"
  }
}
