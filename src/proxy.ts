import { createHash } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { pool } from "@/server/db"

const SESSION_COOKIE = "reseller_session"
const PUBLIC_PATHS = new Set(["/login", "/register"])
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_POSTS = 10
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
}

function isRateLimited(request: NextRequest): boolean {
  if (request.method !== "POST") return false
  const { pathname } = request.nextUrl
  if (pathname !== "/login" && pathname !== "/register") return false

  const now = Date.now()
  if (rateBuckets.size > 1000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key)
    }
  }

  const key = `${pathname}:${clientIp(request)}`
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX_POSTS
}

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

  if (isRateLimited(request)) {
    return new NextResponse("Too Many Requests", { status: 429 })
  }

  if (!session && !PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (session && PUBLIC_PATHS.has(pathname)) {
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
