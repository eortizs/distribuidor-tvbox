import { NextResponse, connection, type NextRequest } from "next/server"

import { createSession } from "@/server/auth/session"
import {
  GOOGLE_LINK_COOKIE,
  GOOGLE_SIGNUP_COOKIE,
  GOOGLE_STATE_COOKIE,
  createGoogleLinkToken,
  exchangeGoogleCode,
  googleLinkCookieOptions,
  googleStateCookieOptions,
  googleSignupCookieOptions,
  googleTenantSignupMode,
  googleClientKit,
  speilinkGoogleRelayHost,
  verifyGoogleSignupCookie,
  verifyGoogleState,
} from "@/server/auth/google"
import { googleKitForFlow, resolveGoogleEntry } from "@/server/auth/google-host"
import {
  buildRelayTargetUrl,
  isTenantOAuthState,
  parseOAuthState,
} from "@/server/auth/google-relay"
import { resolveGoogleUser } from "@/server/auth/google-users"
import { postLoginPathFor } from "@/server/onboarding/status"
import {
  createSignupHandoff,
} from "@/server/onboarding/handoff"
import {
  isSignupRateLimited,
  resolveSignupAffiliate,
  selfSignupEnabled,
} from "@/server/onboarding/signup"
import { updateUser } from "@/server/auth/users"
import { populateFullNameFromGoogle } from "@/server/auth/profile"
import { normalizeEmail } from "@/server/auth/types"
import { findTenantBySlug, tenantIdOfUser } from "@/server/tenant/context"
import {
  isValidTenantSlug,
  resolveTenantHost,
  tenantHostForSlug,
} from "@/server/tenant/hosts"
import { createTenant } from "@/server/tenants/platform"
import { AppError } from "@/server/umejson/types"
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
  // `s.<nonce>` (alta pública por Google) se atiende AQUÍ, no en el relevo.
  if (parsed?.kind === "signup") return null
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
 * ALTA PÚBLICA POR GOOGLE (§4.1 del plan de onboarding): el flujo nació en
 * `/registro` del apex con `state` `s.<nonce>` y la cookie FIRMADA del alta
 * pendiente (negocio + subdominio). Este handler corre SOLO en el apex
 * (host de la URI fija del cliente SPEILink): canjea el código, crea el
 * negocio + dueño solo-Google en una transacción y entrega la sesión por
 * ticket en el subdominio — el mismo cierre del alta por correo.
 */
async function handleGoogleSignup(request: NextRequest): Promise<NextResponse | null> {
  const host = await requestHost()
  if (host !== speilinkGoogleRelayHost()) return null
  if (resolveTenantHost(host).kind === "legacy") return null

  const state = request.nextUrl.searchParams.get("state")
  const parsed = parseOAuthState(state, isValidTenantSlug)
  if (parsed?.kind !== "signup") return null

  const origin = `https://${host}`
  const kit = googleClientKit("speilink")

  // Los retornos conservan &af= (código validado al ARRANCAR el alta; el
  // error pudo ser ajeno a la invitación y el reintento sigue atribuido).
  const failSignup = (reason: string, log?: unknown, keepAffiliateCode?: string | null) => {
    if (log) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `google-oauth: signup_${reason}`,
          detail: log instanceof Error ? log.message : String(log),
        })
      )
    }
    const url = new URL("/registro", origin)
    url.searchParams.set("error", reason)
    if (keepAffiliateCode) url.searchParams.set("af", keepAffiliateCode)
    const response = NextResponse.redirect(url)
    response.cookies.set(GOOGLE_STATE_COOKIE, "", {
      ...googleStateCookieOptions(),
      maxAge: 0,
    })
    response.cookies.set(GOOGLE_SIGNUP_COOKIE, "", {
      ...googleSignupCookieOptions(),
      maxAge: 0,
    })
    return response
  }

  // Cliente y cookies ANTES de gastar el canje: sin kit o sin pendiente
  // válido (firma + nonce + exp) no hay alta que atender.
  if (!kit) return failSignup("google_signup_unavailable", "speilink client missing")
  if (!verifyGoogleState(request.cookies.get(GOOGLE_STATE_COOKIE)?.value, state)) {
    return failSignup("google_signup_state")
  }
  const pending = verifyGoogleSignupCookie(
    request.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value,
    parsed.nonce,
    kit.client
  )
  if (!pending) return failSignup("google_signup_state", "pending cookie invalid")
  const keepAf = pending.affiliateCode ?? null

  if (request.nextUrl.searchParams.get("error")) {
    return failSignup("google_signup_cancelled", undefined, keepAf)
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return failSignup("google_signup_invalid", undefined, keepAf)

  // Puerta revalidada EN el canje (§6.6): la invitación pudo vencer o
  // suspenderse durante el consentimiento; inválida = mismo «cerrado».
  const affiliate = await resolveSignupAffiliate(pending.affiliateCode)
  if (!affiliate && !selfSignupEnabled()) {
    return failSignup("signup_closed")
  }
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  if (isSignupRateLimited(ip)) return failSignup("signup_rate", undefined, keepAf)

  let profile: Awaited<ReturnType<typeof exchangeGoogleCode>>
  try {
    profile = await exchangeGoogleCode(code, kit.redirectUri, kit.client)
  } catch (error) {
    return failSignup("google_signup_failed", error, keepAf)
  }

  // La disponibilidad puede haber cambiado durante el consentimiento.
  const slug = pending.slug
  const taken = await findTenantBySlug(slug).catch(() => null)
  if (taken) return failSignup("signup_slug_taken", undefined, keepAf)

  try {
    const created = await createTenant({
      name: pending.businessName,
      slug,
      ownerEmail: profile.email,
      ownerFullName: profile.name ?? undefined,
      ownerGoogleSub: profile.sub,
      // Atribución única, en la misma transacción del alta.
      referredByAffiliateId: affiliate?.id ?? null,
    })
    const handoff = await createSignupHandoff(created.tenantId, created.ownerId)
    const url = new URL(
      "/onboarding/continuar",
      `https://${tenantHostForSlug(created.slug)}`
    )
    url.searchParams.set("ticket", handoff.token)
    const response = NextResponse.redirect(url.toString())
    response.cookies.set(GOOGLE_STATE_COOKIE, "", {
      ...googleStateCookieOptions(),
      maxAge: 0,
    })
    response.cookies.set(GOOGLE_SIGNUP_COOKIE, "", {
      ...googleSignupCookieOptions(),
      maxAge: 0,
    })
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "onboarding.google_signup_created",
        tenant: created.slug,
        affiliate: affiliate?.code ?? null,
      })
    )
    return response
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "email_taken") {
        return failSignup("google_signup_email_taken", undefined, keepAf)
      }
      if (error.code === "slug_tomado" || error.code === "slug_invalido") {
        return failSignup("signup_slug_taken", undefined, keepAf)
      }
      return failSignup("google_signup_failed", error, keepAf)
    }
    throw error
  }
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
  const signupHandled = await handleGoogleSignup(request)
  if (signupHandled) return signupHandled

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
  }  let profile: Awaited<ReturnType<typeof exchangeGoogleCode>>
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
  // Destino tras entrar: propietario de un negocio sin configurar →
  // asistente. La respuesta conserva la limpieza de la cookie de estado.
  const destination = await postLoginPathFor(resolution.user.id)
  response.headers.set(
    "location",
    new URL(destination, origin).toString()
  )
  return response
}
