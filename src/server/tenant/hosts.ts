/**
 * Resolución pura de hosts a contexto de tenancy (§4.3 del plan).
 *
 * | Host                                        | Resultado           |
 * |---------------------------------------------|---------------------|
 * | `spei.link` (= shortLinkHost)               | `short`             |
 * | `platform.spei.link`                        | `platform`          |
 * | `distribuidor-tvbox.people-ia.com` (legacy) | `legacy`            |
 * | `<slug>.spei.link`                          | `tenant:<slug>`     |
 * | cualquier otro                              | producción: fail-closed (`unknown`); no-producción: `legacy` |
 *
 * En staging (`HOST_SLUG_PREFIX=dev-`) los tenants de prueba son
 * `dev-<slug>.spei.link` y el host legado de staging es `dev-tvbox.spei.link`.
 * `TENANT_HOST_ROUTING=off` es el interruptor de emergencia: todo host se
 * trata como legado (sin tenancy).
 */

export type TenantHost =
  | { kind: "short" }
  | { kind: "platform" }
  | { kind: "legacy" }
  | { kind: "tenant"; slug: string }
  | { kind: "unknown" }

/** Slugs que jamás pueden ser tenants (chocan con infraestructura real). */
export const RESERVED_TENANT_SLUGS = new Set([
  "www",
  "app",
  "api",
  "platform",
  "short",
  "admin",
  "login",
  "mail",
  "ftp",
])

/** Regla del catálogo (db/tenants-schema.sql): forma del slug. */
export const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

export function isValidTenantSlug(slug: string): boolean {
  const prefix = hostSlugPrefix()
  return (
    TENANT_SLUG_RE.test(slug) &&
    !RESERVED_TENANT_SLUGS.has(slug) &&
    (prefix === "" || !slug.startsWith(prefix))
  )
}

export function tenantBaseHost(): string {
  return (process.env.TENANT_BASE_HOST || "spei.link").toLowerCase()
}

export function platformHost(): string {
  return (
    process.env.PLATFORM_HOST || `platform.${tenantBaseHost()}`
  ).toLowerCase()
}

/** Prefijo de slug en staging (`dev-`); vacío en producción. */
export function hostSlugPrefix(): string {
  return (process.env.HOST_SLUG_PREFIX || "").toLowerCase()
}

export function legacyHosts(): string[] {
  const explicit = (process.env.LEGACY_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (explicit.length > 0) return explicit
  const defaults = ["distribuidor-tvbox.people-ia.com"]
  const prefix = hostSlugPrefix()
  if (prefix) {
    defaults.push(`${prefix}tvbox.${tenantBaseHost()}`)
  }
  return defaults
}

/** El enrutamiento de tenancy puede apagarse por emergencia. */
export function tenantRoutingEnabled(): boolean {
  return (process.env.TENANT_HOST_ROUTING || "on").toLowerCase() !== "off"
}

/** El host del dominio corto de links (la landing + /short). */
export function shortHost(): string {
  return (process.env.SPEI_LINK_BASE_URL || "https://spei.link")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
}

function stripPort(host: string): string {
  return host.trim().toLowerCase().split(":")[0] ?? ""
}

/**
 * Resuelve un host de petición (ya sin puerto) a su contexto de host.
 * Fail-closed: hosts desconocidos en producción NO caen al legado.
 */
export function resolveTenantHost(rawHost: string): TenantHost {
  const host = stripPort(rawHost)
  if (!host) return { kind: "unknown" }

  if (!tenantRoutingEnabled()) return { kind: "legacy" }
  if (host === shortHost()) return { kind: "short" }
  if (host === platformHost()) return { kind: "platform" }
  if (legacyHosts().includes(host)) return { kind: "legacy" }

  const base = tenantBaseHost()
  const prefix = hostSlugPrefix()
  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -1 * (base.length + 1))
    if (prefix) {
      if (label === `${prefix}tvbox`) return { kind: "legacy" }
      if (label.startsWith(prefix)) {
        const slug = label.slice(prefix.length)
        return isValidTenantSlug(slug) && !RESERVED_TENANT_SLUGS.has(slug)
          ? { kind: "tenant", slug }
          : { kind: "unknown" }
      }
      // Un subdominio sin el prefijo de staging no existe en staging.
      return { kind: "unknown" }
    }
    return isValidTenantSlug(label)
      ? { kind: "tenant", slug: label }
      : { kind: "unknown" }
  }

  const isProd = process.env.NODE_ENV === "production"
  return isProd ? { kind: "unknown" } : { kind: "legacy" }
}

/** URL raíz pública para el host de un tenant de negocio. */
export function tenantHostForSlug(slug: string): string {
  const prefix = hostSlugPrefix()
  return `${prefix}${slug}.${tenantBaseHost()}`
}
