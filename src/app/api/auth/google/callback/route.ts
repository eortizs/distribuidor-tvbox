import { NextResponse, connection, type NextRequest } from "next/server"

import { createSession } from "@/server/auth/session"
import {
  GOOGLE_LINK_COOKIE,
  GOOGLE_STATE_COOKIE,
  createGoogleLinkToken,
  exchangeGoogleCode,
  googleLinkCookieOptions,
  googleStateCookieOptions,
  googleTenantSignupMode,
  speilinkGoogleRelayHost,
  verifyGoogleState,
} from "@/server/auth/google"
import { googleKitForFlow, resolveGoogleEntry } from "@/server/auth/google-host"
import {
  buildRelayTargetUrl,
  isTenantOAuthState,
  parseOAuthState,
} from "@/server/auth/google-relay"
import { resolveGoogleUser } from "@/server/auth/google-users"
import { updateUser } from "@/server/auth/users"
import { populateFullNameFromGoogle } from "@/server/auth/profile"
import { normalizeEmail } from "@/server/auth/types"
import { tenantIdOfUser } from "@/server/tenant/context"
import {
  isValidTenantSlug,
  resolveTenantHost,
  tenantHostForSlug,
} from "@/server/tenant/hosts"
import { hostTenantIdForRequest, validateSessionHost } from "@/server/tenant/identity"
import { requestHost } from "@/server/tenant/request-host"

function neutralNotFound(): NextResponse {
  return new NextResponse("Not Found", { status: 404 })
}

/**
 * Relevo (host de la URI fija del cliente SPEILink): Google vuelve aquí desde
 * cualquier tenant, el `state` dice a cuál y la petición se reenvía a SU
 * callback, que es quien valida la cookie de estado y canjea el código. El
 * host de destino sale del slug validado y de que el tenant exista y esté
 * activo; sin `state` de tenant no hay a dónde volver (landing del apex).
 */
async function relayToTenant(request: NextRequest): Promise<NextResponse | null> {
  const host = await requestHost()
  if (host !== speilinkGoogleRelayHost()) return null
  // El host del panel legado tiene su propio callback: ahí nunca se relea.
  if (resolveTenantHost(host).kind === "legacy") return null

  const landing = () => NextResponse.redirect(new URL("/", `https://${host}`))
  const state = request.nextUrl.searchParams.get("state")
  const parsed = parseOAuthState(state, isValidTenantSlug)
  if (parsed?.kind !== "tenant") return landing()

  const tenantHost = tenantHostForSlug(parsed.slug)
  if (!(await hostTenantIdForRequest(tenantHost))) return neutralNotFound()
  const target = buildRelayTargetUrl(
    `https://${tenantHost}`,
    {
      code: request.nextUrl.searchParams.get("code"),
      state,
      error: request.nextUrl.searchParams.get("error"),
    },
    isValidTenantSlug
  )
  if (!target) return landing()
  return NextResponse.redirect(target)
}

/**
 * Callback de Google OAuth. Valida el estado anti-CSRF, canjea el código y
 * resuelve la cuenta — todo en el MISMO host donde vivirá la sesión, con el
 * cliente de ese host. Cualquier fallo vuelve al /login de este panel con un
 * error para el comprador; el detalle queda en logs.
 *
 * `connection()` detiene el prerender del build: el estado y el código son
 * de una sola petición y nunca deben congelarse en salida estática.
 */
export async function GET(request: NextRequest) {
  await connection()
  const relayed = await relayToTenant(request)
  if (relayed) return relayed

  const entry = await resolveGoogleEntry()
  if (entry.status === "not-found") return neutralNotFound()
  const origin = entry.origin

  const stateCookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value

  const fail = (reason: string, log?: unknown) => {
    if (log) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `google-oauth: ${reason}`,
          detail: log instanceof Error ? log.message : String(log),
        })
      )
    }
    const url = new URL("/login", origin)
    url.searchParams.set("error", reason)
    const response = NextResponse.redirect(url)
    response.cookies.set(GOOGLE_STATE_COOKIE, "", {
      ...googleStateCookieOptions(),
      maxAge: 0,
    })
    return response
  }

  if (entry.status === "disabled") {
    return fail("google_disabled")
  }
  const kit = googleKitForFlow(entry.flow)
  if (!kit) {
    return fail("google_disabled")
  }

  const state = request.nextUrl.searchParams.get("state")
  const code = request.nextUrl.searchParams.get("code")
  const providerError = request.nextUrl.searchParams.get("error")

  if (providerError) {
    return fail("google_cancelled")
  }
  if (!state || !verifyGoogleState(stateCookie, state)) {
    return fail("google_state")
  }
  // El callback de un tenant solo acepta el `state` nacido en ESE tenant.
  if (
    entry.tenantSlug &&
    !isTenantOAuthState(state, entry.tenantSlug, isValidTenantSlug)
  ) {
    return fail("google_state")
  }

  const response = NextResponse.redirect(new URL("/clientes", origin))
  // El estado es de un solo uso: se limpia aunque el resto del flujo falle.
  response.cookies.set(GOOGLE_STATE_COOKIE, "", {
    ...googleStateCookieOptions(),
    maxAge: 0,
  })

  if (!code) {
    return fail("google_invalid")
  }

  let profile: Awaited<ReturnType<typeof exchangeGoogleCode>>
  try {
    profile = await exchangeGoogleCode(code, kit.redirectUri, kit.client)
  } catch (error) {
    return fail("google_failed", error)
  }

  let resolution: Awaited<ReturnType<typeof resolveGoogleUser>>
  try {
    resolution = await resolveGoogleUser(
      profile,
      normalizeEmail(profile.email),
      {
        tenantId: entry.tenantId,
        allowSignup:
          entry.tenantSlug === null || googleTenantSignupMode() === "open",
      }
    )
  } catch (error) {
    return fail("google_failed", error)
  }

  if (resolution.kind === "conflict") {
    return fail("google_linked_other")
  }
  if (resolution.kind === "elsewhere") {
    return fail("google_other_panel")
  }
  if (resolution.kind === "not_registered") {
    return fail("google_not_registered")
  }

  if (resolution.kind === "link") {
    const linkResponse = NextResponse.redirect(
      new URL("/login?error=google_link_required", origin)
    )
    linkResponse.cookies.set(GOOGLE_STATE_COOKIE, "", {
      ...googleStateCookieOptions(),
      maxAge: 0,
    })
    linkResponse.cookies.set(
      GOOGLE_LINK_COOKIE,
      createGoogleLinkToken(profile, kit.client),
      googleLinkCookieOptions()
    )
    return linkResponse
  }

  // La foto de Google puede cambiar: se refresca la fila si difiere.
  if (profile.picture && profile.picture !== resolution.storedPicture) {
    await updateUser(resolution.user.id, {
      googlePicture: profile.picture,
    })
  }
  // El nombre completo de la entidad Cuenta se rellena solo si está vacío:
  // el campo es editable por el usuario y nunca se pisa una edición manual.
  if (profile.name) {
    await populateFullNameFromGoogle(
      resolution.user.id,
      profile.name,
      resolution.user.username
    )
  }
  // Host ↔ cuenta: la cuenta resuelta debe pertenecer al panel del host
  // actual (misma regla que loginAction; la cookie jamás vale en otro host).
  // En un tenant la comprobación es por tenant exacto, no por tipo de host.
  const resolvedTenantId = await tenantIdOfUser(resolution.user.id)
  const inThisPanel =
    entry.tenantSlug !== null
      ? resolvedTenantId === entry.tenantId
      : validateSessionHost(resolvedTenantId, entry.host)
  if (!inThisPanel) {
    return fail("google_host_mismatch")
  }

  // El tenant de la sesión va explícito: el INSERT corre por systemPool, sin
  // el GUC del contexto, y el trigger no tendría de dónde tomarlo.
  await createSession({ ...resolution.user, tenantId: resolvedTenantId })
  return response
}
