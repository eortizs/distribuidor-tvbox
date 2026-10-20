import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"

import { pool } from "@/server/db"
import {
  SESSION_COOKIE,
  findSessionUser,
  hashSessionToken,
} from "./session-lookup"
import type { AuthUser } from "./types"

export { SESSION_COOKIE }
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export async function createSession(user: AuthUser): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), user.id, hashSessionToken(token), expiresAt]
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

  return findSessionUser(pool, token)
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      hashSessionToken(token),
    ])
  }
  cookieStore.delete(SESSION_COOKIE)
}
