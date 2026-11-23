import { NextResponse, connection } from "next/server"

import {
  GOOGLE_STATE_COOKIE,
  buildGoogleAuthorizationUrl,
  createGoogleState,
  googleStateCookieOptions,
} from "@/server/auth/google"
import { googleKitForFlow, resolveGoogleEntry } from "@/server/auth/google-host"
import { encodeTenantOAuthState } from "@/server/auth/google-relay"

function neutralNotFound(): NextResponse {
  return new NextResponse("Not Found", { status: 404 })
}

/**
 * Inicia el flujo de Google: guarda el estado anti-CSRF en una cookie
 * httpOnly de corta vida y redirige al consentimiento de Google con el
 * cliente que corresponde al HOST (panel legado o SPEILink para los tenants).
 * En un tenant el `state` lleva su slug: es lo que la URI fija de redirección
 * usa para volver a este host (relevo).
 *
 * `connection()` detiene el prerender del build: el handler lee configuración
 * del entorno y emite una cookie con estado aleatorio por petición; sin la
 * marca, el build congelaría la respuesta (p. ej. el guard `google_disabled`
 * si las credenciales no existían al compilar).
 */
export async function GET() {
  await connection()
  const entry = await resolveGoogleEntry()
  if (entry.status === "not-found") return neutralNotFound()

  if (entry.status === "ok") {
    const kit = googleKitForFlow(entry.flow)
    if (kit) {
      const nonce = createGoogleState()
      const state = entry.tenantSlug
        ? encodeTenantOAuthState(entry.tenantSlug, nonce)
        : nonce
      const response = NextResponse.redirect(
        buildGoogleAuthorizationUrl(kit.client, kit.redirectUri, state)
      )
      response.cookies.set(GOOGLE_STATE_COOKIE, state, googleStateCookieOptions())
      return response
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=google_disabled", entry.origin)
  )
}
