import { NextResponse, connection } from "next/server"

import {
  GOOGLE_STATE_COOKIE,
  buildGoogleAuthorizationUrl,
  buildGoogleRedirectUri,
  createGoogleState,
  googleStateCookieOptions,
  isGoogleAuthEnabled,
  publicOrigin,
} from "@/server/auth/google"

/**
 * Inicia el flujo de Google: guarda el estado anti-CSRF en una cookie
 * httpOnly de corta vida y redirige al consentimiento de Google.
 *
 * `connection()` detiene el prerender del build: el handler lee configuración
 * del entorno y emite una cookie con estado aleatorio por petición; sin la
 * marca, el build congelaría la respuesta (p. ej. el guard `google_disabled`
 * si las credenciales no existían al compilar).
 */
export async function GET() {
  await connection()
  if (!isGoogleAuthEnabled()) {
    return NextResponse.redirect(
      new URL("/login?error=google_disabled", publicOrigin())
    )
  }

  const state = createGoogleState()
  const redirectUri = buildGoogleRedirectUri()
  const response = NextResponse.redirect(
    buildGoogleAuthorizationUrl(redirectUri, state)
  )
  response.cookies.set(GOOGLE_STATE_COOKIE, state, googleStateCookieOptions())
  return response
}
