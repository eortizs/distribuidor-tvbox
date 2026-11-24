import { NextResponse, connection, type NextRequest } from "next/server"

import { checkSlugAvailability } from "@/server/onboarding/signup"

/**
 * Disponibilidad de subdominio del registro público (§4.1): route handler y
 * NO acción de servidor — Next despacha acciones en serie en el cliente y un
 * sondeo con debounce las encolaría. Tope 60/min por IP en memoria.
 */

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60
const BUCKET_MAX = 5000
const buckets = new Map<string, { count: number; resetAt: number }>()

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  )
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  if (buckets.size > BUCKET_MAX) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
  }
  const bucket = buckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > MAX_PER_WINDOW
}

export async function GET(request: NextRequest) {
  await connection()
  if (rateLimited(clientIp(request))) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 })
  }
  const raw = request.nextUrl.searchParams.get("slug") ?? ""
  // Forma en el servidor también: un slug gigante o con basura no toca BD.
  const slug = raw.trim().toLowerCase()
  if (slug.length === 0 || slug.length > 40) {
    return NextResponse.json({ available: false, reason: "forma" })
  }
  const result = await checkSlugAvailability(slug)
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  })
}
