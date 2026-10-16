import { redirect } from "next/navigation"

import { getSessionUser } from "./session"
import type { AuthUser, UserRole } from "./types"

export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser()
  if (!user) {
    redirect("/login")
  }
  return user
}

export async function requireRole(role: UserRole): Promise<AuthUser> {
  const user = await requireUser()
  if (user.role !== role) {
    redirect("/entities")
  }
  return user
}
