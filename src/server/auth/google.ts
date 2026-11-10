import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { publicSiteUrl } from "@/server/site-url"
import { normalizeEmail } from "./types"
import { AppError } from "@/server/umejson/types"

/**
 * Google OAuth 2.0 (authorization code flow) para el panel.
 *
 * El flujo vive en dos route handlers: /api/auth/google/start genera el
 * estado anti-CSRF y manda al consentimiento de Google; /api/auth/google/
 * callback valida el estado, canjea el código y resuelve la cuenta. El
 * id_token llega directamente del token endpoint de Google por TLS a cambio
 * del código ligado a nuestro client secret, así que la validación de claims
 * (iss/aud/exp/email_verified) es suficiente sin verificar la firma JWT,
 * que solo es obligatoria para tokens recibidos por otros canales.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

export const GOOGLE_STATE_COOKIE = "reseller_oauth_state"
/** Cookie con la identidad Google pendiente de vincular por contraseña. */
export const GOOGLE_LINK_COOKIE = "reseller_google_link"
const STATE_TTL_SECONDS = 600

export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function createGoogleState(): string {
  return randomBytes(32).toString("base64url")
}

export function verifyGoogleState(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function googleStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  }
}

/**
 * Origen público del sitio detrás de Caddy/Cloudflare: request.url resuelve
 * al host interno (localhost:3010), así que las redirecciones absolutas se
 * construyen con la URL pública compartida (SITE_URL normalizada).
 */
export function publicOrigin(): string {
  return publicSiteUrl()
}

export function buildGoogleRedirectUri(): string {
  return new URL("/api/auth/google/callback", publicOrigin()).toString()
}

export function buildGoogleAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // Forzar selección de cuenta: el comprador puede alternar entre cuentas.
    prompt: "select_account",
    access_type: "online",
  })
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
}

export interface GoogleProfile {
  sub: string
  email: string
  /** URL de la foto de perfil; null si el id_token no la trae. */
  picture: string | null
  /** Nombre completo de la cuenta Google; null si el id_token no lo trae. */
  name: string | null
}

interface GoogleIdTokenClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  sub?: string
  email?: string
  email_verified?: boolean
  picture?: string
  name?: string
}

function decodeIdTokenPayload(idToken: string): GoogleIdTokenClaims {
  const parts = idToken.split(".")
  if (parts.length !== 3) {
    throw new AppError(502, "google_token_invalid", "Malformed Google id_token")
  }
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8")
    return JSON.parse(payload) as GoogleIdTokenClaims
  } catch {
    throw new AppError(502, "google_token_invalid", "Unreadable Google id_token")
  }
}

function validateClaims(claims: GoogleIdTokenClaims, clientId: string): GoogleProfile {
  const fresh =
    typeof claims.exp === "number" && claims.exp * 1000 > Date.now()
  const issuerOk =
    typeof claims.iss === "string" && GOOGLE_ISSUERS.includes(claims.iss)
  const audienceOk =
    (typeof claims.aud === "string" && claims.aud === clientId) ||
    (Array.isArray(claims.aud) && claims.aud.includes(clientId))
  const emailOk =
    typeof claims.email === "string" && claims.email.length > 0

  if (!fresh || !issuerOk || !audienceOk || !emailOk || typeof claims.sub !== "string") {
    throw new AppError(
      502,
      "google_token_invalid",
      "Google id_token failed claim validation"
    )
  }
  if (claims.email_verified !== true) {
    throw new AppError(
      401,
      "google_email_unverified",
      "Google account email is not verified"
    )
  }

  const email = claims.email as string
  const picture =
    typeof claims.picture === "string" && claims.picture.length > 0
      ? claims.picture
      : null
  const name = sanitizeGoogleName(claims.name)
  return { sub: claims.sub, email, picture, name }
}

/** Nombre listo para dynamicProperties.fullName (blancos colapsados, ≤100). */
function sanitizeGoogleName(value: string | undefined): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, 100)
  return cleaned.length > 0 ? cleaned : null
}

const LINK_TTL_SECONDS = 600

/**
 * Clave HMAC de los tokens de vínculo. Sin `GOOGLE_CLIENT_SECRET` el flujo
 * de vínculo queda deshabilitado: la verificación falla cerrado (null) en
 * vez de aceptar firmas con clave vacía, que cualquiera podría forjar.
 */
function googleLinkKey(): string | null {
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  return secret ? secret : null
}

function linkHmac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url")
}

/**
 * Identidad Google pendiente de vincular, firmada con el client secret:
 * solo existe cuando Google está configurado y viaja en una cookie httpOnly.
 * `sub|email|exp|picture|name` — el callback la emite y el login con
 * contraseña la canjea para enlazar google_sub (y su foto y nombre) a la
 * cuenta local probando su dueño.
 */
export function createGoogleLinkToken(profile: GoogleProfile): string {
  const key = googleLinkKey()
  if (!key) {
    throw new AppError(
      500,
      "google_link_unavailable",
      "Google OAuth is not configured; pending links cannot be issued"
    )
  }
  const exp = Date.now() + LINK_TTL_SECONDS * 1000
  const payload = `${profile.sub}|${profile.email}|${exp}|${profile.picture ?? ""}|${profile.name ?? ""}`
  return `${Buffer.from(payload).toString("base64url")}.${linkHmac(payload, key)}`
}

export interface VerifiedGoogleLink {
  sub: string
  email: string
  /** URL de la foto de perfil; null si el id_token no la trajo. */
  picture: string | null
  /** Nombre completo de la cuenta Google; null si no vino en el token. */
  name: string | null
}

/** Valida un token de vínculo (firma + expiración + correo esperado). */
export function verifyGoogleLinkToken(
  token: string | undefined,
  expectedEmail: string
): VerifiedGoogleLink | null {
  const key = googleLinkKey()
  if (!key || !token) return null
  const dot = token.lastIndexOf(".")
  if (dot === -1) return null
  let payload: string
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8")
  } catch {
    return null
  }
  const signature = token.slice(dot + 1)
  const expected = Buffer.from(linkHmac(payload, key))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null
  }

  // 3 campos = formato previo (sin foto); 4 = formato actual con picture.
  // 3 campos = formato previo (sin foto ni nombre); 4 = con foto;
  // 5 = con foto y nombre. Cualquier otro shape se rechaza.
  const parts = payload.split("|")
  if (parts.length !== 3 && parts.length !== 4 && parts.length !== 5) {
    return null
  }
  const [sub, email, exp, picture, name] = parts
  const fresh = /^\d+$/.test(exp) && Number(exp) > Date.now()
  if (!sub || !fresh || normalizeEmail(email) !== normalizeEmail(expectedEmail)) {
    return null
  }
  return {
    sub,
    email,
    picture: picture ? picture : null,
    name: name ? name : null,
  }
}

export function googleLinkCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LINK_TTL_SECONDS,
  }
}

/** Canjea el código de autorización y devuelve el perfil verificado. */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<GoogleProfile> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new AppError(500, "google_not_configured", "Google OAuth is not configured")
  }

  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AppError(502, "google_unreachable", "Could not reach Google token endpoint")
  }

  if (!response.ok) {
    throw new AppError(502, "google_exchange_failed", "Google rejected the authorization code")
  }

  const tokens = (await response.json()) as {
    id_token?: string
    access_token?: string
    error?: string
  }
  if (!tokens.id_token) {
    throw new AppError(502, "google_token_missing", "Google response has no id_token")
  }

  const profile = validateClaims(
    decodeIdTokenPayload(tokens.id_token),
    clientId
  )
  const idTokenHadPicture = profile.picture !== null

  // Google no siempre incluye el claim picture en el id_token (p. ej. en
  // re-consentimientos con sesión activa); el endpoint userinfo lo devuelve
  // de forma fiable con el access_token del mismo canje.
  let userinfoStatus: number | "skip" | "error" = "skip"
  let userinfoSubMatch = false
  if (!profile.picture && tokens.access_token) {
    try {
      const userinfo = await fetch(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(10_000),
      })
      userinfoStatus = userinfo.status
      if (userinfo.ok) {
        const info = (await userinfo.json()) as {
          sub?: string
          picture?: string
          name?: string
        }
        userinfoSubMatch = info.sub === profile.sub
        if (userinfoSubMatch) {
          if (
            typeof info.picture === "string" &&
            info.picture.length > 0
          ) {
            profile.picture = info.picture
          }
          if (!profile.name) {
            profile.name = sanitizeGoogleName(info.name)
          }
        }
      }
    } catch {
      userinfoStatus = "error"
    }
  }
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      google_oauth_picture: {
        idtoken_picture: idTokenHadPicture,
        access_token: Boolean(tokens.access_token),
        userinfo_status: userinfoStatus,
        userinfo_sub_match: userinfoSubMatch,
        picture_resolved: profile.picture !== null,
      },
    })
  )

  return profile
}
