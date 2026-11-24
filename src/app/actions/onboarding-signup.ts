"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  GOOGLE_SIGNUP_COOKIE,
  GOOGLE_STATE_COOKIE,
  createGoogleSignupCookie,
  createGoogleState,
  googleSignupCookieOptions,
  googleStateCookieOptions,
  googleSignupReady,
  googleClientKit,
  buildGoogleAuthorizationUrl,
} from "@/server/auth/google"
import {
  encodeSignupOAuthState,
} from "@/server/auth/google-relay"
import {
  checkSlugAvailability,
  isSignupRateLimited,
  performBusinessSignup,
  selfSignupEnabled,
  signupCallerIp,
} from "@/server/onboarding/signup"
import { shortHost } from "@/server/tenant/hosts"

/**
 * Acciones del formulario de registro público del apex (Fase 1, §4.1 del
 * plan). La validación y el alta viven en performBusinessSignup (compartida
 * con el fallback POST /api/onboarding/signup); aquí solo se traduce al
 * contrato de useActionState y se hace el redirect de entrega de sesión —
 * FUERA del try/catch (Next exige llamarlo así en acciones y route handlers).
 */

export interface SignupBusinessState {
  /** La acción no llegó por la reescritura del apex: el cliente reintenta
   * con fetch directo a POST /api/onboarding/signup. */
  fallback?: boolean
  error: string | null
}

function hostOf(headerValue: string | null | undefined): string {
  return headerValue?.split(":")[0]?.trim().toLowerCase() ?? ""
}

/**
 * PASO GOOGLE del registro (flujo del dueño: «Crear cuenta SPEILink vía
 * Google»): valida el formulario ligero (negocio + subdominio + legal +
 * honeypot), guarda el pendiente en una cookie FIRMADA con el client secret
 * SPEILink y manda al consentimiento de Google con `state` `s.<nonce>`.
 * El callback del apex canjea, crea el negocio y entrega la sesión por
 * ticket como el alta por correo. `button formAction`: los errores vuelven
 * por query (`/registro?error=…`) sin estado de acción.
 */
export async function startGoogleSignupAction(formData: FormData): Promise<void> {
  const h = await headers()
  const host = hostOf(h.get("x-forwarded-host") ?? h.get("host"))
  const businessName = String(formData.get("businessName") ?? "").trim().replace(/\s+/g, " ")
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase()
  const legal = formData.get("legal") === "on" || formData.get("legal") === "true"
  const honeypot = String(formData.get("website") ?? "").trim()

  // URL de regreso al formulario (con el error y los campos conservados).
  // redirect() es never (Next): envolver aquí no rompe el análisis de TS.
  const backUrl = (error: string): string => {
    const url = new URL("/registro", `https://${host === shortHost() ? host : shortHost()}`)
    url.searchParams.set("error", error)
    if (businessName) url.searchParams.set("businessName", businessName)
    if (slug) url.searchParams.set("slug", slug)
    return url.toString()
  }

  if (!selfSignupEnabled()) {
    redirect(backUrl("signup_closed"))
  }
  if (!googleSignupReady()) {
    redirect(backUrl("google_signup_unavailable"))
  }
  const ip = await signupCallerIp()
  if (isSignupRateLimited(ip)) {
    redirect(backUrl("signup_rate"))
  }
  // Honeypot: rechazo en silencio (sin ir a Google).
  if (honeypot.length > 0) {
    redirect(backUrl("signup_rejected"))
  }
  if (!legal) {
    redirect(backUrl("signup_legal"))
  }
  if (businessName.length < 1 || businessName.length > 80) {
    redirect(backUrl("signup_name"))
  }
  const availability = await checkSlugAvailability(slug)
  if (!availability.available) {
    redirect(
      backUrl(
        availability.reason === "reservado"
          ? "signup_slug_reserved"
          : availability.reason === "ocupado"
            ? "signup_slug_taken"
            : "signup_slug_shape"
      )
    )
  }

  const kit = googleClientKit("speilink")
  if (!kit) {
    redirect(backUrl("google_signup_unavailable"))
  }

  const nonce = createGoogleState().slice(0, 32)
  const cookieStore = await cookies()
  cookieStore.set(
    GOOGLE_SIGNUP_COOKIE,
    createGoogleSignupCookie({ businessName, slug, nonce }, kit.client),
    googleSignupCookieOptions()
  )
  // Estado anti-CSRF del flujo: la misma técnica de /api/auth/google/start.
  cookieStore.set(GOOGLE_STATE_COOKIE, encodeSignupOAuthState(nonce), googleStateCookieOptions())

  redirect(buildGoogleAuthorizationUrl(kit.client, kit.redirectUri, encodeSignupOAuthState(nonce)))
}

export async function signupBusinessAction(
  _prev: SignupBusinessState,
  formData: FormData
): Promise<SignupBusinessState> {
  const h = await headers()
  const host = hostOf(h.get("x-forwarded-host") ?? h.get("host"))
  if (host !== shortHost()) {
    // La petición NO pasó por la reescritura del apex (proxy viejo, preview,
    // host del panel): el formulario reintenta por la ruta API, que el
    // matcher del proxy excluye y llega siempre directa.
    return { fallback: true, error: null }
  }

  const ip = await signupCallerIp()
  const result = await performBusinessSignup(
    {
      businessName: String(formData.get("businessName") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      legal: formData.get("legal") === "on" || formData.get("legal") === "true",
      website: String(formData.get("website") ?? ""),
    },
    ip
  )
  if (!result.ok) {
    return { error: result.error }
  }
  redirect(result.redirectUrl)
}
