import type { TenantHost } from "@/server/tenant/hosts"

/**
 * Lógica PURA del relevo de Google OAuth hacia los tenants (sin imports de
 * runtime: la ejercita scripts/test-google-oauth-relay.mjs con Node directo).
 *
 * Google no admite comodines en las URIs de redirección, así que `*.spei.link`
 * no puede registrar un callback por tenant. Se registra UNA sola URI fija
 * (el apex: https://spei.link/api/auth/google/callback) que hace de relevo:
 * Google vuelve ahí y la ruta reenvía `code`/`state` al callback del tenant
 * que inició el flujo, codificado en el propio `state`.
 *
 * Invariantes del relevo:
 * - El host de destino SIEMPRE se construye a partir del slug validado;
 *   ningún valor de la petición llega como host (no hay open redirect).
 * - El relevo NO valida la cookie de estado (vive en el host del tenant):
 *   solo reenvía. Quien canjea el código es el callback del tenant, y ahí la
 *   cookie debe coincidir con el `state`.
 */

export type GoogleFlow = "legacy" | "speilink"

/** Regla canónica del slug (`isValidTenantSlug`): la inyecta el llamador. */
export type SlugValidator = (slug: string) => boolean

export const OAUTH_CALLBACK_PATH = "/api/auth/google/callback"
export const OAUTH_STATE_MAX_LENGTH = 256

const TENANT_STATE_PREFIX = "t"
const SLUG_MAX_LENGTH = 64
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/
const RELAY_PARAM_RE = /^[A-Za-z0-9\-._~+/=:]+$/
const RELAY_PARAM_LIMITS = { code: 2048, error: 128 } as const

export interface TenantOAuthState {
  slug: string
  nonce: string
}

export type ParsedOAuthState =
  | ({ kind: "tenant" } & TenantOAuthState)
  | { kind: "opaque" }

/** `state` de un flujo iniciado en un tenant: `t.<slug>.<nonce>`. */
export function encodeTenantOAuthState(slug: string, nonce: string): string {
  return `${TENANT_STATE_PREFIX}.${slug}.${nonce}`
}

/**
 * `t.<slug>.<nonce>` = flujo de tenant (el relevo sabe a dónde volver);
 * cualquier otra cadena no vacía es el `state` opaco del panel legado.
 * null = malformado (vacío, demasiado largo, prefijo roto o slug que no
 * cumple la regla del catálogo).
 */
export function parseOAuthState(
  state: string | null | undefined,
  isValidSlug: SlugValidator
): ParsedOAuthState | null {
  if (
    typeof state !== "string" ||
    state.length === 0 ||
    state.length > OAUTH_STATE_MAX_LENGTH
  ) {
    return null
  }
  if (state.startsWith(`${TENANT_STATE_PREFIX}.`)) {
    const parts = state.split(".")
    if (parts.length !== 3) return null
    const slug = parts[1] ?? ""
    const nonce = parts[2] ?? ""
    if (
      slug.length === 0 ||
      slug.length > SLUG_MAX_LENGTH ||
      !isValidSlug(slug) ||
      !NONCE_RE.test(nonce)
    ) {
      return null
    }
    return { kind: "tenant", slug, nonce }
  }
  return { kind: "opaque" }
}

/** El `state` pertenece a un flujo iniciado en el tenant dado. */
export function isTenantOAuthState(
  state: string | null | undefined,
  slug: string,
  isValidSlug: SlugValidator
): boolean {
  const parsed = parseOAuthState(state, isValidSlug)
  return parsed?.kind === "tenant" && parsed.slug === slug
}

/**
 * Flujo de Google que aplica a un host:
 * - tenant de negocio ⇒ cliente SPEILink (relevo por la URI fija);
 * - legado (o host habilitado a mano, que se trata como legado) ⇒ cliente
 *   del panel legado, con SU URI registrada;
 * - plataforma, apex y hosts desconocidos ⇒ ninguno.
 * null también cuando el cliente del flujo no está configurado.
 */
export function selectGoogleFlow(input: {
  hostKind: TenantHost["kind"]
  allowedLegacyHost: boolean
  legacyConfigured: boolean
  speilinkConfigured: boolean
}): GoogleFlow | null {
  if (input.hostKind === "tenant") {
    return input.speilinkConfigured ? "speilink" : null
  }
  if (input.hostKind === "legacy" || input.allowedLegacyHost) {
    return input.legacyConfigured ? "legacy" : null
  }
  return null
}

/**
 * URL del callback del tenant al que se reenvía la respuesta de Google.
 * `origin` lo construye el llamador con el host del slug validado. Solo
 * viajan `code`, `state` y `error`, acotados en forma y longitud.
 */
export function buildRelayTargetUrl(
  origin: string,
  params: {
    code?: string | null
    state?: string | null
    error?: string | null
  },
  isValidSlug: SlugValidator
): string | null {
  const parsed = parseOAuthState(params.state, isValidSlug)
  if (parsed?.kind !== "tenant") return null

  let target: URL
  try {
    target = new URL(OAUTH_CALLBACK_PATH, origin)
  } catch {
    return null
  }
  for (const name of ["code", "state", "error"] as const) {
    const value = params[name]
    if (typeof value !== "string" || value.length === 0) continue
    const limit =
      name === "state" ? OAUTH_STATE_MAX_LENGTH : RELAY_PARAM_LIMITS[name]
    if (value.length > limit || !RELAY_PARAM_RE.test(value)) return null
    target.searchParams.set(name, value)
  }
  return target.toString()
}

/**
 * Alta por Google en tenants de negocio: `open` (default) crea la cuenta
 * como sucursal del tenant del host; `invite` solo deja entrar a cuentas
 * ya existentes en ese tenant.
 */
export type TenantSignupMode = "open" | "invite"

export function tenantSignupMode(value: string | undefined): TenantSignupMode {
  return value?.trim().toLowerCase() === "invite" ? "invite" : "open"
}
