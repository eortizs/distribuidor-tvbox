import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"

import { pool } from "@/server/db"
import type { AuthUser } from "./types"

export const SESSION_COOKIE = "reseller_session"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function createSession(user: AuthUser): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), user.id, hashToken(token), expiresAt]
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

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const result = await pool.query(
    `SELECT u.id, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  )
  if (!result.rowCount) return null

  return {
    id: result.rows[0].id as string,
    username: result.rows[0].username as string,
    role: result.rows[0].role as AuthUser["role"],
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      hashToken(token),
    ])
  }
  cookieStore.delete(SESSION_COOKIE)
}
