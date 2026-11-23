export type UserRole =
  | "admin"
  | "distribuidor"
  | "propietario"
  | "sucursal"

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
 * Fase 2 (expansión de roles): `propietario`/`sucursal` son los nombres
 * nuevos de `admin`/`distribuidor`. Durante el periodo de expansión el
 * código decide por estos dos predicados (nunca por literales); el rename de
 * datos llega con db/apply-roles-rename.mjs y entonces el tipo se reduce a
 * `plataforma | propietario | sucursal`.
 */
export function isOwnerRole(role: string): boolean {
  return role === "admin" || role === "propietario"
}

export function isBranchRole(role: string): boolean {
  return role === "distribuidor" || role === "sucursal"
}

export function isPlatformRole(role: string): boolean {
  return role === "plataforma"
}

export function isValidRole(role: string): role is UserRole {
  return (
    role === "admin" ||
    role === "distribuidor" ||
    role === "propietario" ||
    role === "sucursal"
  )
}

/** Etiqueta visible del rol (nombres nuevos ya en la UI). */
export function roleLabel(role: string): string {
  if (isOwnerRole(role)) return "Propietario"
  if (isBranchRole(role)) return "Sucursal"
  if (isPlatformRole(role)) return "Plataforma"
  return role
}
