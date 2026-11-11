import { publicSiteUrl } from "@/server/site-url"
import { AppError } from "@/server/umejson/types"

/**
 * OAuth 2.0 de Google para los conectores (authorization code flow con
 * refresh token offline). Es un flujo distinto al de inicio de sesión
 * (`src/server/auth/google.ts`): aquí el código se canjea para guardar
 * tokens de API de la cuenta que el usuario elige, no para crear una
 * sesión; por eso usa su propia ruta de callback y su propia cookie de
 * estado.
 *
 * El id_token que Google devuelve con el canje solo se usa para anotar qué
 * cuenta de Google quedó conectada (email), validando audiencia y vigencia.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"

/** Scopes de identidad siempre presentes: identifican la cuenta conectada. */
const SCOPES_IDENTIDAD = ["openid", "email"]

export const GOOGLE_CONECTOR_STATE_COOKIE = "reseller_conector_state"

export function isGoogleConectorEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

/** URI de redirección del flujo de conectores, distinta a la del login. */
export function buildGoogleConectorRedirectUri(): string {
  return new URL("/api/conectores/google/callback", publicSiteUrl()).toString()
}

/**
 * URL de consentimiento para un conector de Google. `access_type=offline` +
 * `prompt=consent` garantizan el refresh_token en la respuesta; sin ellos
 * Google solo lo entrega en el primer consentimiento de la app.
 */
export function buildGoogleConectorAuthorizationUrl(
  scopes: string[],
  state: string
): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: buildGoogleConectorRedirectUri(),
    response_type: "code",
    scope: [...SCOPES_IDENTIDAD, ...scopes].join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    // Forzar selección de cuenta: el usuario puede conectar otra cuenta.
    include_granted_scopes: "true",
  })
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
}

export interface GoogleConectorTokens {
  accessToken: string
  /** Presente salvo que Google lo omita (ya concedido antes sin prompt). */
  refreshToken: string | null
  /** Vencimiento del access_token en ms desde ahora. */
  expiresInMs: number
  scope: string
  /** Email de la cuenta conectada; null si el id_token no lo trae. */
  accountEmail: string | null
}

interface GoogleIdTokenClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  email?: string
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
}

async function postTokenEndpoint(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new AppError(500, "google_conector_disabled", "Google OAuth is not configured")
  }
  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AppError(502, "google_unreachable", "Could not reach Google token endpoint")
  }
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse
  if (!response.ok) {
    // invalid_grant: el código expiró, se usó dos veces o el usuario revocó.
    throw new AppError(
      502,
      payload.error === "invalid_grant" ? "google_grant_invalid" : "google_exchange_failed",
      "Google rejected the token request"
    )
  }
  return payload
}

/** Email de la cuenta conectada desde el id_token del canje (best effort). */
function emailDeIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const parts = idToken.split(".")
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as GoogleIdTokenClaims
    const audOk =
      (typeof claims.aud === "string" && claims.aud === process.env.GOOGLE_CLIENT_ID) ||
      (Array.isArray(claims.aud) && claims.aud.includes(process.env.GOOGLE_CLIENT_ID ?? ""))
    const fresh = typeof claims.exp === "number" && claims.exp * 1000 > Date.now()
    if (!audOk || !fresh || typeof claims.email !== "string" || !claims.email) {
      return null
    }
    return claims.email
  } catch {
    return null
  }
}

/** Canjea el código de autorización del conector por tokens de API. */
export async function exchangeGoogleConectorCode(
  code: string,
  redirectUri: string
): Promise<GoogleConectorTokens> {
  const payload = await postTokenEndpoint(
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
  )
  if (!payload.access_token) {
    throw new AppError(502, "google_token_missing", "Google response has no access_token")
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresInMs: Math.max(60, Number(payload.expires_in ?? 3600)) * 1000,
    scope: payload.scope ?? "",
    accountEmail: emailDeIdToken(payload.id_token),
  }
}

/** Renueva el access_token con el refresh_token guardado. */
export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<Omit<GoogleConectorTokens, "refreshToken" | "accountEmail">> {
  const payload = await postTokenEndpoint(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    })
  )
  if (!payload.access_token) {
    throw new AppError(502, "google_token_missing", "Google response has no access_token")
  }
  return {
    accessToken: payload.access_token,
    expiresInMs: Math.max(60, Number(payload.expires_in ?? 3600)) * 1000,
    scope: payload.scope ?? "",
  }
}

/**
 * Revoca un token en Google (best effort): al desconectar o reemplazar la
 * conexión, el token viejo deja de servir aunque la fila ya no exista.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Best effort: la conexión local se elimina igual; el token caduca solo.
  }
}
