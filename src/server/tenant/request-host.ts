import { headers } from "next/headers"

/**
 * Host de la petición HTTP actual (x-forwarded-host del borde de Caddy/
 * Cloudflare, o host). Aislado en módulo propio para que guards y sesión
 * compartan la MISMA lectura que src/proxy.ts (que usa su propia copia
 * sobre NextRequest: no puede importar next/headers).
 */
export async function requestHost(): Promise<string> {
  const store = await headers()
  const raw =
    store.get("x-forwarded-host")?.split(",")[0] ?? store.get("host") ?? ""
  return raw.split(":")[0]?.trim().toLowerCase() ?? ""
}

/**
 * Origen público de la petición actual (esquema + host del borde), para
 * redirigir dentro del MISMO host en paneles que no tienen URL propia en el
 * entorno (cada tenant `*.spei.link`). En producción todo el tráfico público
 * es https y el esquema no se toma de cabeceras del cliente.
 */
export async function requestOrigin(): Promise<string> {
  const scheme = process.env.NODE_ENV === "production" ? "https" : "http"
  return `${scheme}://${await requestHost()}`
}
