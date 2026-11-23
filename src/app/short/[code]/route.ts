import { NextResponse, connection, type NextRequest } from "next/server"
import { runWithTenant } from "@/server/tenant/context"

import { paymentOrderMoney } from "@/lib/links-pago"
import { buildPaymentOrderOgHtml, isPreviewCrawler } from "@/lib/links-pago-og"
import {
  findPendingPaymentOrderByAnyCode,
  findResolvedPaymentOrderByAnyCode,
  markPaymentOrderLinkOpened,
} from "@/server/links-pago/repository"
import { shortLinkBaseUrl } from "@/server/site-url"
import {
  buildPaymentOrderShortLink,
  buildPaymentOrderWaLink,
  isPaymentLinkCode,
} from "@/server/links-pago/wa-link"

/*
 * Shortener de links de pago (spei.link/<CÓDIGO>): el CÓDIGO es el mismo
 * código de concepto de la orden (payment_orders). El proxy reescribe aquí
 * las peticiones cuyo host es el dominio corto (SPEI_LINK_BASE_URL), así
 * que esta ruta no requiere sesión y solo se alcanza por ese host.
 *
 *   - código ACTIVO (pending | verifying) → 302 a wa.me con la SOLICITUD
 *     prellenada (el pagador aterriza en el chat del agente, igual que con
 *     el link wa.me de siempre). Los lookups reusan las puertas del canal
 *     WhatsApp (activas primero, resueltas después): los códigos son
 *     reciclables y un código que hoy tiene orden viva NUNCA debe responder
 *     con el estado de una orden resuelta vieja que lo tuvo antes.
 *     Los RASTREADORES de vista previa (WhatsApp pide la metadata al
 *     compartir el link) reciben la página Open Graph de SPEILink: la
 *     tarjeta muestra el badge, el importe y cómo pagar, en lugar de la
 *     portada genérica de wa.me. La persona que abre el link nunca pasa
 *     por esa página: sigue con el 302.
 *   - código RESUELTO (paid | rejected | cancelled) → 410 con página mínima
 *     honesta (el link ya no está activo; el código pudo ser reasignado).
 *   - código desconocido o de forma inválida → 404 con página mínima.
 *
 * Cabeceras en TODAS las respuestas: `Cache-Control: no-store` (el destino
 * de un link puede cambiar en cualquier momento — nunca 301 ni caché de
 * borde) y `X-Robots-Tag: noindex`. Anti-enumeración: tope de 30 códigos
 * fallidos/min por IP real (bucket en memoria, con tope duro de tamaño).
 * El PEEK del bucket corre ANTES de tocar BD — el límite corta el coste de
 * la consulta, no solo la respuesta — y solo los fallos lo incrementan.
 */

const MISS_LIMIT = 30
const MISS_WINDOW_MS = 60_000
/** Tope duro del mapa: jamás crece sin límite aunque roten las IPs. */
const MISS_BUCKET_MAX = 5000
const missBuckets = new Map<string, { count: number; resetAt: number }>()

/**
 * IP real del visitante. Detrás de Cloudflare (la topología documentada),
 * `cf-connecting-ip` la fija el borde y no es suplantable por cabeceras del
 * cliente; la ÚLTIMA entrada de `x-forwarded-for` es la que añadió el proxy
 * más cercano (las primeras las escribe el cliente).
 */
function requestIp(request: NextRequest): string {
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

/** Poda el mapa cuando llega al tope: expirados primero, luego el más viejo. */
function pruneMissBuckets(now: number): void {
  if (missBuckets.size < MISS_BUCKET_MAX) return
  for (const [key, bucket] of missBuckets) {
    if (bucket.resetAt <= now) missBuckets.delete(key)
  }
  while (missBuckets.size >= MISS_BUCKET_MAX) {
    const oldest = missBuckets.keys().next().value
    if (oldest === undefined) break
    missBuckets.delete(oldest)
  }
}

/**
 * Lectura SIN incrementar: true si esta IP ya agotó su cupo de fallos.
 * Corre ANTES de cualquier consulta — agotado el cupo, el endpoint no toca
 * BD para esa IP hasta que la ventana expire.
 */
function missLimited(ip: string): boolean {
  const bucket = missBuckets.get(ip)
  return (
    bucket !== undefined &&
    bucket.resetAt > Date.now() &&
    bucket.count > MISS_LIMIT
  )
}

/** Registra UN fallo del lookup y responde true si se superó el límite. */
function registerMiss(ip: string): boolean {
  const now = Date.now()
  pruneMissBuckets(now)
  let bucket = missBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + MISS_WINDOW_MS }
    missBuckets.set(ip, bucket)
  }
  bucket.count += 1
  return bucket.count > MISS_LIMIT
}

function withNoCache(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("X-Robots-Tag", "noindex")
  return response
}

/** Página HTML mínima para los estados sin redirect (es-MX, sin assets). */
function htmlResponse(
  status: number,
  title: string,
  message: string
): NextResponse {
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
  return withNoCache(
    new NextResponse(html, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  )
}

/**
 * Vista previa del link (la tarjeta de WhatsApp): página con las etiquetas
 * Open Graph de SPEILink —badge, importe y cómo pagar—. Solo la sirven a
 * los rastreadores; la persona que abre el link recibe el 302 al chat.
 */
function previewResponse(params: {
  amountMxn: number
  code: string
  waUrl: string
}): NextResponse {
  const html = buildPaymentOrderOgHtml({
    amountLabel: paymentOrderMoney(params.amountMxn),
    canonicalUrl: buildPaymentOrderShortLink(params.code),
    imageUrl: `${shortLinkBaseUrl()}/spei-link-og.png`,
    waUrl: params.waUrl,
  })
  return withNoCache(
    new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  )
}

function tooManyRequests(): NextResponse {
  return htmlResponse(
    429,
    "Demasiadas consultas",
    "Espera unos segundos e inténtalo de nuevo."
  )
}

function notFound(): NextResponse {
  return htmlResponse(
    404,
    "Link no encontrado",
    "Este enlace de pago no existe o expiró. Verifica el enlace con quien te lo compartió."
  )
}

function gone(): NextResponse {
  return htmlResponse(
    410,
    "Link ya no activo",
    "Este enlace de pago ya fue resuelto. Pide un link nuevo a quien te lo compartió."
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  // cacheComponents: sin esto la ruta se prerenderiza en el build y sirve
  // el redirect congelado (patrón /api/auth/google/*).
  await connection()

  const { code } = await params
  const ip = requestIp(request)

  // Gate ANTES de BD: agotado el cupo de fallos, esta IP no consulta nada.
  if (missLimited(ip)) return tooManyRequests()

  // Next ya entrega el param percent-decodeado: la doble decodificación
  // puede lanzar URIError con secuencias truncadas (p. ej. "/short/%").
  // Mismo camino que un código inválido — 404 con registro del fallo.
  let normalized: string
  try {
    normalized = decodeURIComponent(code).trim().toUpperCase()
  } catch {
    registerMiss(ip)
    return notFound()
  }

  if (!isPaymentLinkCode(normalized)) {
    if (registerMiss(ip)) return tooManyRequests()
    return notFound()
  }

  // Activas primero (el índice único parcial las cubre): un código que hoy
  // tiene orden viva redirige aunque una resuelta vieja lo haya tenido.
  const order = await findPendingPaymentOrderByAnyCode([normalized]).catch(
    () => null
  )
  if (order) {
    const target = buildPaymentOrderWaLink(order.amountMxn)
    if (!target) {
      return htmlResponse(
        503,
        "Servicio no disponible",
        "El canal de pagos no está disponible en este momento. Inténtalo más tarde."
      )
    }

    // Tarjeta de WhatsApp: los rastreadores de vista previa reciben la
    // metadata de SPEILink (badge, importe y cómo pagar). No cuentan como
    // "apertura" del link: el pagador de verdad sigue entrando por el 302.
    if (isPreviewCrawler(request.headers.get("user-agent"))) {
      return previewResponse({
        amountMxn: order.amountMxn,
        code: order.code,
        waUrl: target,
      })
    }

    // Primera apertura del link (trazabilidad del embudo; escribe UNA
    // vez y no interviene en decisiones de dinero). Best-effort detached:
    // el redirect no espera por la bitácora.
    // Escritura bajo el tenant de la orden (§4.2 ruta pública). La
    // resolución ya trae tenant_id (lista blanca); el resto corre aislado.
    void runWithTenant(order.tenantId, () =>
      markPaymentOrderLinkOpened(order.id)
    ).catch(() => {})
    return withNoCache(NextResponse.redirect(target, 302))
  }

  // Sin activa: ¿el código corresponde a una orden YA resuelta? 410 honesto
  // en lugar del 404 genérico (replay del estado sin revelar datos).
  const resolved = await findResolvedPaymentOrderByAnyCode([normalized]).catch(
    () => null
  )
  if (resolved) return gone()

  if (registerMiss(ip)) return tooManyRequests()
  return notFound()
}
