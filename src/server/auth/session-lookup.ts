import { createHash } from "node:crypto"
import type { Pool } from "pg"

import type { UserRole } from "./types"

export const SESSION_COOKIE = "reseller_session"

export interface SessionLookupUser {
  id: string
  username: string
  role: UserRole
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function findSessionUser(
  db: Pick<Pool, "query">,
  token: string
): Promise<SessionLookupUser | null> {
  const result = await db.query(
    `SELECT u.id, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)]
  )
  if (!result.rowCount) return null

  return {
    id: result.rows[0].id as string,
    username: result.rows[0].username as string,
    role: result.rows[0].role as UserRole,
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
