import { createHash } from "node:crypto"
import type { Pool } from "pg"

import type { UserRole } from "./types"

export const SESSION_COOKIE = "reseller_session"

export interface SessionLookupUser {
  id: string
  username: string
  role: UserRole
  /** URL de la foto de perfil de Google; null si la cuenta no la tiene. */
  googlePicture: string | null
  /** Tenant de la cuenta; null = cuenta de plataforma. */
  tenantId: string | null
  /** Estado del tenant (active/suspended); null para cuentas de plataforma. */
  tenantStatus: "active" | "suspended" | null
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Lookup de sesión por token. Corre sobre systemPool (lista blanca del
 * tenancy): el contexto viene DE la sesión (users.tenant_id), así que el
 * propio lookup no puede depender de él. Devuelve también el estado del
 * tenant para rechazar sesiones de tenants suspendidos.
 */
export async function findSessionUser(
  db: Pick<Pool, "query">,
  token: string
): Promise<SessionLookupUser | null> {
  const result = await db.query(
    `SELECT u.id, u.username, u.role, u.google_picture,
            u.tenant_id, t.status AS tenant_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)]
  )
  if (!result.rowCount) return null

  const row = result.rows[0]
  return {
    id: row.id as string,
    username: row.username as string,
    role: row.role as UserRole,
    googlePicture: (row.google_picture as string | null) ?? null,
    tenantId: (row.tenant_id as string | null) ?? null,
    tenantStatus: (row.tenant_status as "active" | "suspended" | null) ?? null,
  }
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue

    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }

  return null
}
