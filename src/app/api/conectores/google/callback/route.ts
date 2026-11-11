import { NextResponse, connection, type NextRequest } from "next/server"

import { requireApiUser } from "@/server/auth/api"
import { isConectorConectable } from "@/lib/conectores"
import { verifyEstadoConector } from "@/server/conectores/estado"
import {
  GOOGLE_CONECTOR_STATE_COOKIE,
  buildGoogleConectorRedirectUri,
  exchangeGoogleConectorCode,
} from "@/server/conectores/google-oauth"
import { guardarConexion } from "@/server/conectores/repository"
import { conectorStateCookieOptions } from "@/server/conectores/estado"
import { publicSiteUrl } from "@/server/site-url"

/**
 * Callback de Google para el flujo de conectores (distinto al del login):
 * valida el estado anti-CSRF, canjea el código por tokens de API y guarda
 * la conexión cifrada del usuario. Vuelve siempre a la pantalla de
 * conectores con el resultado en la query (`conectado` o `error`).
 *
 * `connection()` detiene el prerender del build: el estado y el código son
 * de una sola petición y nunca deben congelarse en salida estática.
 */
export async function GET(request: NextRequest) {
  await connection()
  const origin = publicSiteUrl()

  const back = (params: Record<string, string>) => {
    const url = new URL("/modulos/conectores", origin)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    const response = NextResponse.redirect(url)
    // El estado es de un solo uso: se limpia en cualquier salida.
    response.cookies.set(GOOGLE_CONECTOR_STATE_COOKIE, "", {
      ...conectorStateCookieOptions(),
      maxAge: 0,
    })
    return response
  }

  const user = await requireApiUser()
  if (!user) {
    return back({ error: "sesion_requerida" })
  }

  const providerError = request.nextUrl.searchParams.get("error")
  if (providerError) {
    // El usuario canceló el consentimiento en Google.
    return back({ error: "google_cancelado", conector: "google-calendar" })
  }

  const state = request.nextUrl.searchParams.get("state")
  const code = request.nextUrl.searchParams.get("code")
  const resuelto = verifyEstadoConector(
    request.cookies.get(GOOGLE_CONECTOR_STATE_COOKIE)?.value,
    state
  )
  if (!resuelto) {
    return back({ error: "estado_invalido" })
  }
  const { connectorId } = resuelto
  if (!code || !isConectorConectable(connectorId)) {
    return back({ error: "conector_invalido", conector: connectorId })
  }

  try {
    const tokens = await exchangeGoogleConectorCode(
      code,
      buildGoogleConectorRedirectUri()
    )
    await guardarConexion(user.id, connectorId, tokens)
    return back({ conectado: connectorId })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: "conectores: google callback failed",
        detail,
        connectorId,
      })
    )
    return back({ error: "google_fallo", conector: connectorId })
  }
}
