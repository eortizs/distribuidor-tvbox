import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"

import { systemPool } from "@/server/db"
import { setRequestContext } from "@/server/tenant/context"
import {
  SESSION_COOKIE,
  findSessionUser,
  hashSessionToken,
} from "./session-lookup"
import type { AuthUser } from "./types"

export { SESSION_COOKIE }
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export interface AuthenticatedSession extends AuthUser {
  /** Tenant del usuario (null = plataforma). El store ALS lo fija. */
  tenantId: string | null
}

export async function createSession(
  user: AuthUser & { tenantId?: string | null }
): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  // El tenant de la sesión es el del USUARIO (NULL = plataforma); explícito
  // para que no dependa del GUC del trigger (el lookup va por systemPool).
  await systemPool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, tenant_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      crypto.randomUUID(),
      user.id,
      hashSessionToken(token),
      expiresAt,
      user.tenantId ?? null,
    ]
  )

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

/**
 * Resuelve el usuario de la sesión Y FIJA el contexto de tenancy para el
 * resto de la petición (ALS enterWith): toda consulta posterior del handler
 * corre bajo el tenant del usuario. La cookie de un host ajeno (sesión de A
 * en host de B) se rechaza: sin contexto ⇒ sin datos.
 */
export async function getSessionUser(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const { requestHost } = await import("@/server/tenant/request-host")
  const session = await findSessionUser(systemPool, token)
  if (!session) return null

  // Tenant suspendido: la sesión queda rechazada (sin contexto ⇒ sin datos).
  if (session.tenantStatus === "suspended") return null

  const { validateSessionHost } = await import("@/server/tenant/identity")
  if (!validateSessionHost(session.tenantId, await requestHost())) {
    return null
  }

  setRequestContext({
    tenantId: session.tenantId,
    platform: false,
    source: "session",
  })

  // El tenant viaja EN el resultado: `setRequestContext` usa ALS enterWith,
  // que NO alcanza la continuación del llamador tras los awaits de esta
  // función (requireUser/requireApiUser leían currentTenantContext() como
  // null y user.tenantId quedaba vacío en TODA la app). La sesión es la
  // fuente; el store ALS queda solo como cortesía para el mismo async chain.
  return {
    id: session.id,
    username: session.username,
    role: session.role,
    googlePicture: session.googlePicture,
    tenantId: session.tenantId,
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await systemPool.query("DELETE FROM sessions WHERE token_hash = $1", [
      hashSessionToken(token),
    ])
  }
  cookieStore.delete(SESSION_COOKIE)
}
