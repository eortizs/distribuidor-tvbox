/**
 * Lógica PURA del sistema de afiliados (plan speilink-afiliados §6.2): sin
 * BD, sin env y sin Next — la ejercita scripts/test-afiliados.mjs con Node
 * directo. Fuente única de la FORMA del código, del parseo de la ruta
 * `/afiliado/…`, de la lista de palabras vetadas y de la resolución de la
 * atribución (query gana sobre cookie).
 */

/** 32 símbolos sin ambigüedad (el mismo alfabeto de los links de pago). */
export const AFFILIATE_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/

export function isAffiliateCode(code: string): boolean {
  return AFFILIATE_CODE_RE.test(code)
}

/**
 * Parseo de la ruta `/afiliado/…` del dominio corto (tabla §6.4 del plan):
 * - `root`: `/afiliado` o `/afiliado/` → 302 a `/`.
 * - `code`: `/afiliado/ABCD` (acepta mayúsculas, minúsculas y barra final).
 * - `invalid`: 3 o 5 caracteres, segmento extra o basura → 404 SIN tocar BD.
 */
export type ParsedAffiliatePath =
  | { kind: "root" }
  | { kind: "code"; code: string }
  | { kind: "invalid" }

export function parseAffiliatePath(pathname: string): ParsedAffiliatePath {
  const trimmed =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname
  if (trimmed !== "/afiliado" && !trimmed.startsWith("/afiliado/")) {
    return { kind: "invalid" }
  }
  const segments = trimmed
    .slice("/afiliado".length)
    .split("/")
    .filter((segment) => segment.length > 0)
  if (segments.length === 0) return { kind: "root" }
  if (segments.length !== 1) return { kind: "invalid" }
  const code = (segments[0] ?? "").toUpperCase()
  return isAffiliateCode(code) ? { kind: "code", code } : { kind: "invalid" }
}

/** Cookie de atribución (30 días): HttpOnly, Secure, SameSite=Lax, Path=/. */
export const AFFILIATE_COOKIE = "spei_afiliado"
export const AFFILIATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/**
 * Cabecera de petición con la que el proxy le dice a la página de dónde
 * salió el afiliado (el proxy la borra de la petición entrante antes de
 * fijarla: jamás se confía en una cabecera del cliente).
 */
export const AFFILIATE_MODE_HEADER = "x-spei-afiliado"
export type AffiliateMode = "link" | "cookie"

export function isAffiliateMode(value: string | null | undefined): value is AffiliateMode {
  return value === "link" || value === "cookie"
}

/** Normaliza un código recibido (query o cookie); null si la forma no vale. */
export function normalizeAffiliateCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? ""
  return isAffiliateCode(trimmed) ? trimmed : null
}

/**
 * Resolución de la atribución (§6.3): el código de la QUERY gana sobre la
 * cookie (el último enlace explícito es el que cuenta; la cookie es solo el
 * recuerdo de la visita anterior). null = sin atribución válida.
 */
export function resolveAffiliateAttribution(input: {
  query?: string | null
  cookie?: string | null
}): string | null {
  return (
    normalizeAffiliateCode(input.query) ?? normalizeAffiliateCode(input.cookie)
  )
}

/** Ruta de registro con la atribución visible (`/registro?af=CODE`). */
export function affiliateRegisterPath(code: string): string {
  return `/registro?af=${encodeURIComponent(code)}`
}

/** Enlace público del afiliado sobre la base dada (host corto). */
export function affiliateLinkUrl(code: string, baseUrl: string): string {
  try {
    return new URL(`/afiliado/${code}`, baseUrl).toString()
  } catch {
    return `/afiliado/${code}`
  }
}

/**
 * ¿Cuándo habilita un CTA de la landing? (§6.5): con el lanzamiento abierto
 * O cuando la petición trae un afiliado — la invitación habilita aunque
 * `LAUNCH_ENABLED` siga en preventa.
 */
export function affiliateCtaEnabled(
  launchEnabled: boolean,
  affiliateCode: string | null | undefined
): boolean {
  return launchEnabled || Boolean(affiliateCode)
}

/**
 * Lista corta de palabras vetadas (§5.3): el generador reintenta y un código
 * personalizado se rechaza si cae aquí. Todo dentro del alfabeto de 32.
 */
const BANNED_AFFILIATE_CODES = new Set([
  "CACA",
  "CULO",
  "PUTA",
  "PENE",
  "TETA",
  "CAGA",
  "JODE",
  "KIKE",
])

export function isBannedAffiliateCode(code: string): boolean {
  return BANNED_AFFILIATE_CODES.has(code.toUpperCase())
}
