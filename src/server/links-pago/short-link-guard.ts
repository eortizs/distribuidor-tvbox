/*
 * Piezas compartidas de las rutas PÚBLICAS del dominio corto (spei.link):
 * el shortener de links de pago (`/<CÓDIGO>`) y el del QR fijo de cobro
 * (`/cobro/<CÓDIGO>`). Ambas responden sin sesión a cualquier visitante, así
 * que comparten tres cosas:
 *
 *   - Cabeceras en TODAS las respuestas: `Cache-Control: no-store` (el
 *     destino de un link puede cambiar en cualquier momento — nunca 301 ni
 *     caché de borde) y `X-Robots-Tag: noindex`.
 *   - Páginas HTML mínimas para los estados sin redirect (es-MX, sin assets).
 *   - Anti-enumeración: tope de códigos fallidos por minuto por IP real
 *     (bucket en memoria, con tope duro de tamaño). El PEEK del bucket se
 *     hace ANTES de tocar BD — el límite corta el coste de la consulta, no
 *     solo la respuesta — y solo los fallos lo incrementan.
 *
 * Tipado sobre `Response` (no `NextResponse`) para no arrastrar el runtime
 * de Next a quien solo necesite la página o el bucket.
 */

export interface ShortLinkRequest {
  headers: { get(name: string): string | null }
}

/**
 * IP real del visitante. Detrás de Cloudflare (la topología documentada),
 * `cf-connecting-ip` la fija el borde y no es suplantable por cabeceras del
 * cliente; la ÚLTIMA entrada de `x-forwarded-for` es la que añadió el proxy
 * más cercano (las primeras las escribe el cliente).
 */
export function shortLinkIp(request: ShortLinkRequest): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim()
  if (cf) return cf
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const entries = forwarded
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    const last = entries[entries.length - 1]
    if (last) return last
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

/** Sella las cabeceras de no-caché y no-indexado; devuelve la misma respuesta. */
export function withShortLinkHeaders<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("X-Robots-Tag", "noindex")
  return response
}

/** Página HTML mínima para los estados sin redirect (es-MX, sin assets). */
export function shortLinkPage(
  status: number,
  title: string,
  message: string
): Response {
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #fafafa; color: #171717; }
      main { text-align: center; padding: 2rem; max-width: 28rem; }
      h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
      p { color: #525252; font-size: .95rem; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`
  return withShortLinkHeaders(
    new Response(html, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  )
}

export function shortLinkNotFound(): Response {
  return shortLinkPage(
    404,
    "Link no encontrado",
    "Este enlace de pago no existe o expiró. Verifica el enlace con quien te lo compartió."
  )
}

export function shortLinkTooManyRequests(): Response {
  return shortLinkPage(
    429,
    "Demasiadas consultas",
    "Espera unos segundos e inténtalo de nuevo."
  )
}

export function shortLinkUnavailable(): Response {
  return shortLinkPage(
    503,
    "Servicio no disponible",
    "El canal de pagos no está disponible en este momento. Inténtalo más tarde."
  )
}

export interface MissLimiter {
  /** Lectura SIN incrementar: true si la IP ya agotó su cupo de fallos. */
  limited(ip: string): boolean
  /** Registra UN fallo y responde true si con él se superó el límite. */
  register(ip: string): boolean
}

/**
 * Cubeta anti-enumeración por IP: `limit` fallos por `windowMs`. El mapa
 * tiene un tope duro (`maxKeys`): podado de expirados y, si sigue lleno
 * porque rotan las IPs, se descarta la más vieja — jamás crece sin límite.
 */
export function createMissLimiter(input: {
  limit: number
  windowMs: number
  maxKeys: number
}): MissLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()

  const prune = (now: number): void => {
    if (buckets.size < input.maxKeys) return
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
    while (buckets.size >= input.maxKeys) {
      const oldest = buckets.keys().next().value
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  return {
    limited(ip: string): boolean {
      const bucket = buckets.get(ip)
      return (
        bucket !== undefined &&
        bucket.resetAt > Date.now() &&
        bucket.count > input.limit
      )
    },
    register(ip: string): boolean {
      const now = Date.now()
      prune(now)
      let bucket = buckets.get(ip)
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + input.windowMs }
        buckets.set(ip, bucket)
      }
      bucket.count += 1
      return bucket.count > input.limit
    },
  }
}
