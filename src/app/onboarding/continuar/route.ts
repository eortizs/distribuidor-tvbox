import { NextResponse, connection, type NextRequest } from "next/server"

import { createSession } from "@/server/auth/session"
import { findUserById } from "@/server/auth/users"
import { redeemSignupHandoff } from "@/server/onboarding/handoff"

/**
 * Canje del ticket de entrega (§4.2): el registro del apex manda al dueño a
 * `https://<slug>.spei.link/onboarding/continuar?ticket=<token>` y ESTA ruta
 * crea la sesión en su subdominio SIN volver a pedir la contraseña.
 *
 * - La petición llega anónima al host del tenant: el contexto es el tenant
 *   del HOST y RLS solo deja ver tickets de ESE tenant (un ticket abierto en
 *   otro subdominio no existe aquí).
 * - Canje atómico de un solo uso (UPDATE … WHERE used_at IS NULL AND
 *   expires_at > now()); sin fila → /login?error=handoff_invalid.
 * - Cache-Control no-store + noindex: el token viaja en la URL (historial).
 */

/** Origen público de la petición (tras Cloudflare/Caddy: host reenviado). */
async function publicOrigin(request: NextRequest): Promise<string> {
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host") ??
    request.nextUrl.host
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (forwardedHost.startsWith("localhost") ? "http" : "https")
  return `${proto}://${forwardedHost.split(":")[0].toLowerCase()}`
}

export async function GET(request: NextRequest) {
  await connection()
  const origin = await publicOrigin(request)

  const fail = () => {
    const response = NextResponse.redirect(
      new URL("/login?error=handoff_invalid", origin),
      303
    )
    response.headers.set("cache-control", "no-store")
    response.headers.set("x-robots-tag", "noindex")
    return response
  }

  const token = (request.nextUrl.searchParams.get("ticket") ?? "").trim()
  if (token.length < 20 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return fail()
  }

  const redeemed = await redeemSignupHandoff(token)
  if (!redeemed) {
    return fail()
  }

  // El usuario canjeado pertenece a ESTE tenant (RLS): visible bajo el
  // contexto del host. Una fila ajena jamás llega aquí.
  const user = await findUserById(redeemed.userId)
  if (!user) {
    return fail()
  }

  await createSession({
    id: user.id,
    username: user.username,
    role: user.role,
    tenantId: redeemed.tenantId,
  })

  const response = NextResponse.redirect(
    new URL("/onboarding", origin),
    303
  )
  response.headers.set("cache-control", "no-store")
  response.headers.set("x-robots-tag", "noindex")
  return response
}
