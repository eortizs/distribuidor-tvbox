import { resolveTenantHost } from "./hosts"

/**
 * Identidad de tenancy: constantes compartidas entre el SQL de la migración
 * (db/tenants-schema.sql — el UUID debe coincidir) y el runtime, más las
 * validaciones host ↔ tenant (§4.2 del plan).
 */

/**
 * Tenant legado `tvbox`: todo lo existente del panel actual. DEBE coincidir
 * con el INSERT de db/tenants-schema.sql (verificado en el arranque).
 */
export const LEGACY_TENANT_ID = "8e83b5cc-9f43-28b2-a8f3-2882fef090a8"

export const LEGACY_TENANT_SLUG = "tvbox"

/** Forma de un uuid v4 (validación antes de fijar el GUC). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un tenant id válido para el GUC (defensa antes de interpolar en SQL). */
export function isValidTenantId(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value)
}

/**
 * Validación host ↔ tenant (§4.2): la cookie de A en el host de B NO vale.
 * - Cuenta de plataforma (tenant_id null) ⇒ solo el host de plataforma.
 * - Tenant legado ⇒ solo un host legado.
 * - Tenant de negocio ⇒ solo su subdominio (con el prefijo de staging).
 * - Host `short` (spei.link) no porta sesiones: rechazado.
 */
export function validateSessionHost(
  tenantId: string | null,
  rawHost: string
): boolean {
  const resolved = resolveTenantHost(rawHost)
  if (tenantId === null) {
    return resolved.kind === "platform"
  }
  if (!isValidTenantId(tenantId)) return false
  if (resolved.kind === "platform") return false
  if (tenantId === LEGACY_TENANT_ID) return resolved.kind === "legacy"
  return resolved.kind === "tenant"
}

/**
 * Tenant esperado para un host ANÓNIMO (login/registro/bootstrap): el tenant
 * del host. null = host sin tenant (short/unknown ⇒ no hay alta posible).
 * La búsqueda de usuarios por correo en el login corre bajo este contexto.
 */
export async function hostTenantIdForRequest(
  rawHost: string
): Promise<string | null> {
  const { findTenantBySlug, findLegacyTenant } = await import("./context")
  const resolved = resolveTenantHost(rawHost)
  if (resolved.kind === "tenant") {
    const tenant = await findTenantBySlug(resolved.slug)
    if (!tenant || tenant.status !== "active") return null
    return tenant.id
  }
  if (resolved.kind === "legacy") {
    const legacy = await findLegacyTenant()
    return legacy.id
  }
  return null
}
