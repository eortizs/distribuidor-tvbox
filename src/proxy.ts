import { createHash } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { pool } from "@/server/db"

const SESSION_COOKIE = "reseller_session"

async function getSessionRole(
  token: string
): Promise<{ role: string } | null> {
  try {
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const result = await pool.query(
      `SELECT u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash]
    )
    return result.rowCount
      ? { role: result.rows[0].role as string }
      : null
  } catch {
    return null
  }
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await getSessionRole(token) : null
  const { pathname } = request.nextUrl

  if (!session && pathname !== "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (session && pathname === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/entities"
    return NextResponse.redirect(url)
  }

  if (session && session.role !== "admin" && pathname.startsWith("/users")) {
    const url = request.nextUrl.clone()
    url.pathname = "/entities"
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)",
  ],
}
