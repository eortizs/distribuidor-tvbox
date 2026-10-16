export type UserRole = "admin" | "distribuidor"

export interface AuthUser {
  id: string
  username: string
  role: UserRole
}

export function isValidRole(role: string): role is UserRole {
  return role === "admin" || role === "distribuidor"
}
