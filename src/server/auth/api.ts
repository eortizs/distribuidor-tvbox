import { getSessionUser } from "./session"
import type { AuthUser } from "./types"

export async function requireApiUser(): Promise<AuthUser | null> {
  try {
    return await getSessionUser()
  } catch {
    return null
  }
}

export function unauthorizedResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "unauthorized", message: "Authentication required" },
    },
    { status: 401 }
  )
}

export function actorFor(user: AuthUser): string {
  return `user:${user.username}`
}
