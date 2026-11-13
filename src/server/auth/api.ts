import { getSessionUser } from "./session"
import type { AuthUser } from "./types"

export async function requireApiUser(): Promise<AuthUser | null> {
  try {
    return await getSessionUser()
  } catch {
    return null
  }
}

/** Como `requireApiUser`, pero null también para no-admins. */
export async function requireAdminApiUser(): Promise<AuthUser | null> {
  const user = await requireApiUser()
  return user && user.role === "admin" ? user : null
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

export function forbiddenResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "forbidden", message: "Solo el administrador puede hacer esto." },
    },
    { status: 403 }
  )
}

export function actorFor(user: AuthUser): string {
  return `user:${user.username}`
}
