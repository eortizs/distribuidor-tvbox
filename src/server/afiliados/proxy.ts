import { NextResponse, type NextRequest } from "next/server"

import {
  AFFILIATE_COOKIE,
  AFFILIATE_COOKIE_MAX_AGE_SECONDS,
  AFFILIATE_MODE_HEADER,
  normalizeAffiliateCode,
  parseAffiliatePath,
} from "@/lib/afiliados"
import { isPreviewCrawler } from "@/lib/links-pago-og"
import {
  findActiveAffiliateByCode,
  incrementAffiliateClick,
} from "@/server/afiliados/repository"
import { shortLinkBaseUrl } from "@/server/site-url"

/**
 * Enlace público del afiliado en el dominio corto (plan speilink-afiliados
 * §6.4). Lo invoca la rama del host corto de src/proxy.ts — DESPUÉS de las
 * rutas públicas y ANTES de la validación de código de link (el espacio
 * `spei.link/<4>` es de links de pago y jamás toca este módulo).
 *
 * | Solicitud                        | Respuesta |
 * |----------------------------------|-----------|
 * | `/afiliado`, `/afiliado/`        | 302 a `/` |
 * | `/afiliado/<forma inválida>`     | 404, sin tocar BD |
 * | `/afiliado/ABCD` inexistente o suspendido | 404 neutro (sin oráculo) |
 * | `/afiliado/ABCD` activo (browser)| cookie 30 días si el código cambió, 1 clic, rewrite a /short/afiliado/ABCD |
 * | `/` con cookie válida y activa   | rewrite a /short/afiliado/ABCD; sin clic ni renovación |
 * | `/` con cookie inválida/suspendida | landing estática + cookie borrada |
 *
 * El CLIC es la primera apertura por navegador en la ventana: el mismo
 * código ya en la cookie no cuenta de nuevo y los rastreadores de vista
 * previa no cuentan ni fijan cookie. La cabecera `x-spei-afiliado` (link |
 * cookie) le dice a la página el modo; se borra de la petición entrante
 * antes de fijarla (jamás se confía en una cabecera del cliente).
 */

const MISS_LIMIT = 30
const MISS_WINDOW_MS = 60_000
const MISS_BUCKET_MAX = 5000
const missBuckets = new Map<string, { count: number; resetAt: number }>()

function requestIp(request: NextRequest): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim()
  if (cf) return cf
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const entries = forwarded
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    const last = entries[entries.length - 1]
    if (last) return last
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

function pruneMissBuckets(now: number): void {
  if (missBuckets.size < MISS_BUCKET_MAX) return
  for (const [key, bucket] of missBuckets) {
    if (bucket.resetAt <= now) missBuckets.delete(key)
  }
  while (missBuckets.size >= MISS_BUCKET_MAX) {
    const oldest = missBuckets.keys().next().value
    if (oldest === undefined) break
    missBuckets.delete(oldest)
  }
}

/** Lectura SIN incrementar: true si esta IP ya agotó su cupo de fallos. */
function missLimited(ip: string): boolean {
  const bucket = missBuckets.get(ip)
  return (
    bucket !== undefined &&
    bucket.resetAt > Date.now() &&
    bucket.count > MISS_LIMIT
  )
}

/** Registra UN fallo del lookup y responde true si se superó el límite. */
function registerMiss(ip: string): boolean {
  const now = Date.now()
  pruneMissBuckets(now)
  let bucket = missBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + MISS_WINDOW_MS }
    missBuckets.set(ip, bucket)
  }
  bucket.count += 1
  return bucket.count > MISS_LIMIT
}

function withNoCache(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("X-Robots-Tag", "noindex")
  return response
}

function neutral404(): NextResponse {
  return withNoCache(new NextResponse("Not Found", { status: 404 }))
}

function cookieOptions(): {
  httpOnly: boolean
  secure: boolean
  sameSite: "lax"
  path: "/"
  maxAge: number
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AFFILIATE_COOKIE_MAX_AGE_SECONDS,
  }
}

/**
 * Reescribe a la landing del afiliado con la cabecera de modo. La petición
 * entrante NUNCA trae la cabecera: se construye desde request.headers
 * limpiándola antes (anti-spoofing).
 */
function rewriteToAffiliateLanding(
  request: NextRequest,
  code: string,
  mode: "link" | "cookie"
): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = `/short/afiliado/${code}`
  const headers = new Headers(request.headers)
  headers.delete(AFFILIATE_MODE_HEADER)
  headers.set(AFFILIATE_MODE_HEADER, mode)
  return NextResponse.rewrite(url, { request: { headers } })
}

function clearAffiliateCookie(response: NextResponse): void {
  response.cookies.set(AFFILIATE_COOKIE, "", {
    ...cookieOptions(),
    maxAge: 0,
  })
}

function trimmedPath(request: NextRequest): string {
  const pathname = request.nextUrl.pathname
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname
}

/** ¿La petición vive bajo /afiliado*? El módulo solo atiende ese namespace. */
function isAffiliatePath(pathname: string): boolean {
  return pathname === "/afiliado" || pathname.startsWith("/afiliado/")
}

/**
 * Punto de entrada desde src/proxy.ts (host corto). Devuelve null cuando la
 * petición NO es de afiliados y el caller debe continuar con su flujo
 * (rutas públicas, links de pago, landing).
 */
export async function handleAffiliateShortRequest(
  request: NextRequest
): Promise<NextResponse | null> {
  const trimmed = trimmedPath(request)

  // La RAÍZ del dominio con cookie de atribución: la landing habilitada del
  // afiliado (§6.4). Sin clic ni renovación de ventana: el visitante solo
  // regresó a spei.link, no volvió a pasar por el enlace.
  if (trimmed === "/") {
    const cookieCode = normalizeAffiliateCode(
      request.cookies.get(AFFILIATE_COOKIE)?.value
    )
    if (!cookieCode) return null
    let affiliate: Awaited<ReturnType<typeof findActiveAffiliateByCode>> = null
    try {
      affiliate = await findActiveAffiliateByCode(cookieCode)
    } catch {
      // BD caída: landing estática SIN borrar la cookie (podría volver).
      return null
    }
    if (affiliate) {
      const response = rewriteToAffiliateLanding(request, affiliate.code, "cookie")
      return withNoCache(response)
    }
    // Código inválido o suspendido: landing estática y cookie fuera.
    const url = request.nextUrl.clone()
    url.pathname = "/short"
    const headers = new Headers(request.headers)
    headers.delete(AFFILIATE_MODE_HEADER)
    const response = NextResponse.rewrite(url, { request: { headers } })
    clearAffiliateCookie(response)
    return withNoCache(response)
  }

  if (!isAffiliatePath(trimmed)) return null

  const parsed = parseAffiliatePath(trimmed)
  if (parsed.kind === "root") {
    return withNoCache(
      NextResponse.redirect(new URL("/", shortLinkBaseUrl()), 302)
    )
  }
  if (parsed.kind === "invalid") {
    // 404 SIN tocar BD (forma inválida jamás consulta).
    return neutral404()
  }

  const ip = requestIp(request)
  // Peek ANTES de BD (patrón del shortener): agotado el cupo, sin consulta.
  if (missLimited(ip)) {
    return withNoCache(
      new NextResponse("Demasiadas consultas", { status: 429 })
    )
  }

  let affiliate: Awaited<ReturnType<typeof findActiveAffiliateByCode>> = null
  try {
    affiliate = await findActiveAffiliateByCode(parsed.code)
  } catch {
    // Fallo transitorio de BD: fail-closed sin gastar la cuota de fallos.
    return neutral404()
  }
  if (!affiliate) {
    // Inexistente y suspendido responden el MISMO 404 (sin oráculo).
    if (registerMiss(ip)) {
      return withNoCache(
        new NextResponse("Demasiadas consultas", { status: 429 })
      )
    }
    return neutral404()
  }

  // Rastreadores de vista previa: solo ven la landing; sin cookie ni clic.
  if (isPreviewCrawler(request.headers.get("user-agent"))) {
    return withNoCache(rewriteToAffiliateLanding(request, affiliate.code, "link"))
  }

  // El clic es la PRIMERA apertura del navegador con este código en la
  // ventana: mismo código ya en la cookie no cuenta de nuevo (refrescar la
  // página no infla la cifra). Se ESPERA antes de responder: el runtime del
  // proxy cancela promesas detached al devolver la respuesta (hallazgo
  // 2026-11-24: el conteo desacoplado nunca llegó a BD). Falla abierta: un
  // fallo de BD no rompe el enlace.
  const cookieCode = normalizeAffiliateCode(
    request.cookies.get(AFFILIATE_COOKIE)?.value
  )
  if (cookieCode !== affiliate.code) {
    await incrementAffiliateClick(affiliate.code).catch(() => undefined)
  }

  const response = rewriteToAffiliateLanding(request, affiliate.code, "link")
  // Cookie de 30 días (HttpOnly, Secure, Lax): abrir el enlace RENOVA la
  // ventana; el «último enlace gana» y el clic se cuenta solo al cambiar.
  response.cookies.set(AFFILIATE_COOKIE, affiliate.code, cookieOptions())
  return withNoCache(response)
}
