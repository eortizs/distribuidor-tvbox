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
