export type UserRole = "plataforma" | "propietario" | "sucursal"

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
  return role
}
