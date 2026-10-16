export type UserRole = "admin" | "distribuidor"

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
}

export function isValidRole(role: string): role is UserRole {
  return role === "admin" || role === "distribuidor"
}
