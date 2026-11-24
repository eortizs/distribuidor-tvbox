import { isOwnerRole } from "@/server/auth/types"
import { NextResponse, type NextRequest } from "next/server"

import { findSessionUser } from "@/server/auth/session-lookup"
import { systemPool } from "@/server/db"
import { shortLinkHost } from "@/server/site-url"
import { isPaymentLinkCode } from "@/lib/links-pago"
import {
  modulesForKind,
  routeModuleForPath,
  tenantAllows,
  type TenantModule,
} from "@/lib/tenant-modules"
import { findTenantBySlug } from "@/server/tenant/context"
import { resolveTenantHost, type TenantHost } from "@/server/tenant/hosts"

const SESSION_COOKIE = "reseller_session"
const PUBLIC_PATHS = new Set(["/login", "/register", "/onboarding/continuar"])
/**
 * Rutas públicas del APEX (spei.link, §4.1): registro, legal y acceso se
 * reescriben a /short/<ruta> ANTES de validar el código de link y sin gate
 * de sesión (el visitante del registro no tiene cuenta).
 */
const SHORT_HOST_PUBLIC_PATHS = new Set(["/registro", "/privacidad", "/terminos", "/acceder"])
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
  if (pathname !== "/login" && pathname !== "/register" && pathname !== "/registro") return false

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

async function getSession(token: string) {
  try {
    return await findSessionUser(systemPool, token)
  } catch {
    return null
  }
}

function requestHost(request: NextRequest): string {
  const raw =
    request.headers.get("x-forwarded-host")?.split(",")[0] ??
    request.headers.get("host") ??
    ""
  return raw.split(":")[0]?.trim().toLowerCase() ?? ""
}

function neutral404(): NextResponse {
  return new NextResponse("Not Found", { status: 404 })
}

/**
 * Bloqueo de páginas por módulo del tenant (§4.5): en un host de negocio,
 * todo lo que no es núcleo redirige al inicio (la API responde 403 por su
 * cuenta; esto es la capa de páginas). El legado permite los tres módulos.
 */
function pageAllowedForHost(
  resolved: TenantHost,
  pathname: string
): boolean {
  const requiredModule: TenantModule = routeModuleForPath(pathname)
  if (resolved.kind === "platform") {
    // La consola de plataforma (fase 2) define sus propias páginas.
    return true
  }
  return tenantAllows(modulesForKind("business"), requiredModule)
}

export async function proxy(request: NextRequest) {
  const host = requestHost(request)

  // Dominio corto de links de pago (spei.link): reescritura interna al
  // handler /short ANTES del gate de sesión — el pagador externo no tiene
  // cuenta y jamás debe ver /login. La forma del código se valida AQUÍ con
  // el mismo validador del módulo (fuente única): basura o segmentos
  // malformados (% truncado, %2F, multi-segmento) responden 404 en el proxy
  // porque el decodificado de params de Next lanzaría URIError → 500 antes
  // de llegar al handler.
  if (host === shortLinkHost()) {
    const url = request.nextUrl.clone()
    const trimmed =
      url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname
    const segment = trimmed.slice(1)

    // Rutas públicas del apex (registro/legal/acceso): sin gate de sesión y
    // antes de la validación de código de link.
    if (SHORT_HOST_PUBLIC_PATHS.has(trimmed)) {
      url.pathname = `/short${trimmed}`
      return NextResponse.rewrite(url)
    }

    if (segment.length > 0 && !isPaymentLinkCode(segment.toUpperCase())) {
      return new NextResponse("Link no encontrado", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      })
    }
    url.pathname = `/short${trimmed === "/" ? "" : trimmed}`
    return NextResponse.rewrite(url)
  }

  const resolvedHost = resolveTenantHost(host)

  // Fail-closed: host desconocido (o slug inexistente/reservado) en
  // producción ⇒ 404 neutro; jamás sirve el panel en un host ajeno.
  if (resolvedHost.kind === "unknown") {
    return neutral404()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const lookedUp = token ? await getSession(token) : null

  // Host ↔ sesión (§4.2): la cookie de A en el host de B NO vale ⇒ la
  // petición se trata como anónima del host actual. Un tenant suspendido
  // también pierde su sesión (la lookup ya trae el estado).
  let session = lookedUp
  if (session) {
    if (session.tenantStatus === "suspended") {
      session = null
    } else {
      const { validateSessionHost } = await import("@/server/tenant/identity")
      if (!validateSessionHost(session.tenantId, host)) {
        session = null
      }
    }
  }

  const { pathname } = request.nextUrl

  // La pantalla de clientes vivía en /entities; los enlaces antiguos siguen.
  if (pathname === "/entities") {
    const url = request.nextUrl.clone()
    url.pathname = "/clientes"
    return NextResponse.redirect(url)
  }

  // El hub Herramientas pasó a /modulos; los enlaces antiguos siguen.
  if (pathname === "/herramientas" || pathname.startsWith("/herramientas/")) {
    const url = request.nextUrl.clone()
    url.pathname = pathname.replace(/^\/herramientas/, "/modulos")
    return NextResponse.redirect(url)
  }

  if (isRateLimited(request)) {
    return new NextResponse("Too Many Requests", { status: 429 })
  }

  // El registro local SOLO existe en el host legado (§4.5).
  if (pathname === "/register" && resolvedHost.kind !== "legacy") {
    return neutral404()
  }

  // Host de tenant de negocio: el slug debe existir y estar activo; en
  // usuarios SIN sesión el login está permitido (contexto = tenant del host).
  if (resolvedHost.kind === "tenant") {
    const tenant = await findTenantBySlug(resolvedHost.slug)
    if (!tenant || tenant.status !== "active") {
      return neutral404()
    }
    if (!PUBLIC_PATHS.has(pathname) && !pageAllowedForHost(resolvedHost, pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = "/clientes"
      return NextResponse.redirect(url)
    }
  }

  if (!session && !PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (session && PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/clientes"
    return NextResponse.redirect(url)
  }

  if (session && !isOwnerRole(session.role) && pathname.startsWith("/users")) {
    const url = request.nextUrl.clone()
    url.pathname = "/clientes"
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!api|eve/|\\.well-known|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)",
  ],
}
