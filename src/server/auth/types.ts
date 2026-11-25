/**
 * Los CUATRO perfiles del panel (plan speilink-afiliados): plataforma (el
 * "Admin"), afiliado (cuenta SIN tenant con enlace propio), propietario y
 * sucursal. El afiliado jamás vive dentro de un tenant, y `isValidRole`
 * (editor de roles del panel) NO lo acepta por diseño.
 */
export type UserRole = "plataforma" | "afiliado" | "propietario" | "sucursal"

/**
 * entityName of the umeJSON entity that mirrors each auth user.
 */
export const ACCOUNT_ENTITY_NAME = "Cuenta"

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value)
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export interface AuthUser {
  id: string
  username: string
  role: UserRole
  /** URL de la foto de perfil de Google; undefined/null = usar iniciales. */
  googlePicture?: string | null
  /**
   * Tenant de la cuenta (users.tenant_id); null = cuenta de plataforma o
   * legado sin contexto resuelto. Lo fija el guard al validar la sesión.
   */
  tenantId?: string | null
}

/**
 * Predicados de rol (nombres finales tras el rename de
 * db/apply-roles-rename.mjs). El código NUNCA compara literales de rol
 * directamente: siempre pasa por aquí.
 */
export function isOwnerRole(role: string): boolean {
  return role === "propietario"
}

export function isBranchRole(role: string): boolean {
  return role === "sucursal"
}

export function isPlatformRole(role: string): boolean {
  return role === "plataforma"
}

/** Cuenta de afiliado: SIN tenant (users.tenant_id NULL) con enlace propio. */
export function isAffiliateRole(role: string): boolean {
  return role === "afiliado"
}

/**
 * Editor de roles del panel legado (§6.1): un usuario CON tenant no puede
 * ser afiliado — el rol solo se asigna en el alta de la consola de
 * plataforma (cuenta sin tenant). No cambia con el resto.
 */
export function isValidRole(role: string): role is UserRole {
  return (
    role === "plataforma" || role === "propietario" || role === "sucursal"
  )
}

/** Etiqueta visible del rol (nombres nuevos ya en la UI). */
export function roleLabel(role: string): string {
  if (isOwnerRole(role)) return "Propietario"
  if (isBranchRole(role)) return "Sucursal"
  if (isPlatformRole(role)) return "Plataforma"
  if (isAffiliateRole(role)) return "Afiliado"
  return role
}

/**
 * Destino tras iniciar sesión por PERFIL (§6.9; reestructura de bloques
 * 2026-11-24): plataforma y afiliado → `/inicio` del host de plataforma (la
 * consola se reestructuró en los cinco bloques del panel); resto → el panel
 * (el destino de los negocios con onboarding incompleto lo refina
 * postLoginPathFor, que delega aquí las cuentas sin tenant).
 */
export function homePathForUser(user: { role: string }): string {
  if (isPlatformRole(user.role)) return "/inicio"
  if (isAffiliateRole(user.role)) return "/inicio"
  return "/clientes"
}
