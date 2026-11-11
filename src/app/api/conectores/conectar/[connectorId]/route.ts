import { NextResponse, connection, type NextRequest } from "next/server"

import { requireApiUser } from "@/server/auth/api"
import { findConector, isConectorConectable } from "@/lib/conectores"
import {
  GOOGLE_CONECTOR_STATE_COOKIE,
  buildGoogleConectorAuthorizationUrl,
  isGoogleConectorEnabled,
} from "@/server/conectores/google-oauth"
import {
  conectorStateCookieOptions,
  crearEstadoConector,
} from "@/server/conectores/estado"
import { publicSiteUrl } from "@/server/site-url"

type RouteContext = { params: Promise<{ connectorId: string }> }

/**
 * Inicia la conexión de un conector: valida sesión y catálogo, guarda el
 * estado anti-CSRF (`<connectorId>.<aleatorio>`) en una cookie httpOnly y
 * redirige al consentimiento del proveedor.
 *
 * `connection()` detiene el prerender del build: el handler lee el entorno
 * y la sesión y emite una cookie aleatoria por petición.
 */
export async function GET(_request: NextRequest, ctx: RouteContext) {
  await connection()
  const { connectorId } = await ctx.params
  const origin = publicSiteUrl()

  const user = await requireApiUser()
  if (!user) {
    return NextResponse.redirect(new URL("/login", origin))
  }

  const fail = (reason: string) => {
    const url = new URL("/modulos/conectores", origin)
    url.searchParams.set("error", reason)
    url.searchParams.set("conector", connectorId)
    return NextResponse.redirect(url)
  }

  const conector = findConector(connectorId)
  if (!conector || !isConectorConectable(connectorId)) {
    return fail("conector_invalido")
  }

  // Hoy solo Google tiene flujo implementado; el callback vive por proveedor.
  if (conector.providerId !== "google" || !isGoogleConectorEnabled()) {
    return fail("proveedor_no_configurado")
  }

  const state = crearEstadoConector(connectorId)
  const response = NextResponse.redirect(
    buildGoogleConectorAuthorizationUrl(conector.scopes ?? [], state)
  )
  response.cookies.set(GOOGLE_CONECTOR_STATE_COOKIE, state, conectorStateCookieOptions())
  return response
}
