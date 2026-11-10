export type UserRole = "admin" | "distribuidor"

/** entityName of the umeJSON entity that mirrors each auth user. */
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
}

export function isValidRole(role: string): role is UserRole {
  return role === "admin" || role === "distribuidor"
}
