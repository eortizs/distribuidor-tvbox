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
