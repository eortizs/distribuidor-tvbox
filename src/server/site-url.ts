/**
 * URL pública del panel: el mismo criterio para todos los módulos (OAuth de
 * Google, Mercado Pago, redirecciones de rutas). `SITE_URL` normalizada
 * (trim + sin slashes finales) y, si no existe, el dominio de producción,
 * que es el único despliegue de este panel detrás de Caddy/Cloudflare.
 */
export function publicSiteUrl(): string {
  return (
    process.env.SITE_URL?.trim() ||
    "https://distribuidor-tvbox.people-ia.com"
  ).replace(/\/+$/, "")
}

/**
 * URL pública del dominio corto de links de pago: `SPEI_LINK_BASE_URL`
 * normalizada y, si no existe, el dominio de producción. La usan la creación
 * de links (`spei.link/<código>`) y el gate de host del proxy, que rutea
 * ese dominio al handler del shortener sin gate de sesión.
 */
export function shortLinkBaseUrl(): string {
  return (
    process.env.SPEI_LINK_BASE_URL?.trim() ||
    "https://spei.link"
  ).replace(/\/+$/, "")
}

/** Host del dominio corto (sin puerto ni esquema), para el gate del proxy. */
export function shortLinkHost(): string {
  try {
    return new URL(shortLinkBaseUrl()).hostname.toLowerCase()
  } catch {
    return "spei.link"
  }
}
