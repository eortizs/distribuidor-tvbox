import { NextResponse, connection, type NextRequest } from "next/server"

import { isCobradorQrCode } from "@/lib/links-pago"
import { buildPaymentQrOgHtml, isPreviewCrawler } from "@/lib/links-pago-og"
import { findPaymentQrOwnerPublic } from "@/server/links-pago/repository"
import {
  createMissLimiter,
  shortLinkIp,
  shortLinkNotFound,
  shortLinkTooManyRequests,
  shortLinkUnavailable,
  withShortLinkHeaders,
} from "@/server/links-pago/short-link-guard"
import { shortLinkBaseUrl } from "@/server/site-url"
import {
  buildPaymentQrShortLink,
  buildPaymentQrWaLink,
  resolvePaymentOrderWhatsAppNumber,
} from "@/server/links-pago/wa-link"

/*
 * Shortener del QR FIJO de cobro (spei.link/cobro/<CÓDIGO>): el código es
 * el del QR permanente de UN cobrador (users.payment_qr_code). El proxy
 * reescribe aquí las peticiones del dominio corto bajo `/cobro/`, sin gate
 * de sesión (el pagador es externo).
 *
 *   - código de un cobrador de un negocio ACTIVO → 302 a wa.me con la
 *     SOLICITUD del QR prellenada («Solicito realizar un pago. (cobrador
 *     XXXXXX)»): a diferencia del link de importe, aquí no hay orden — el
 *     mensaje identifica al COBRADOR y el pagador declara monto y concepto
 *     en el chat (src/server/links-pago/qr-fijo.ts).
 *   - código desconocido, de forma inválida o de un negocio suspendido →
 *     404 NEUTRO (sin distinguir un caso de otro: un código es una
 *     capacidad y el 404 no da oráculo).
 *   - sin número de WhatsApp en el negocio → 503 (no hay chat al que mandar).
 *
 * El QR se imprime una vez y vive para siempre, así que el paso por el
 * dominio corto es lo que permite cambiar de número sin reimprimir. Los
 * RASTREADORES de vista previa reciben la tarjeta Open Graph de SPEILink.
 * Cabeceras, páginas y anti-enumeración: short-link-guard.ts (compartidas
 * con el shortener de links).
 */

const MISS_LIMIT = 30
const MISS_WINDOW_MS = 60_000
/** Tope duro del mapa: jamás crece sin límite aunque roten las IPs. */
const MISS_BUCKET_MAX = 5000
const missLimiter = createMissLimiter({
  limit: MISS_LIMIT,
  windowMs: MISS_WINDOW_MS,
  maxKeys: MISS_BUCKET_MAX,
})

/** Tarjeta de WhatsApp del QR fijo: sin importe (lo define el pagador). */
function previewResponse(params: { code: string; waUrl: string }): NextResponse {
  const html = buildPaymentQrOgHtml({
    canonicalUrl: buildPaymentQrShortLink(params.code),
    imageUrl: `${shortLinkBaseUrl()}/spei-link-og.png`,
    waUrl: params.waUrl,
  })
  return withShortLinkHeaders(
    new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  // cacheComponents: sin esto la ruta se prerenderiza en el build y sirve
  // una respuesta congelada (patrón del shortener de links).
  await connection()

  const { code } = await params
  const ip = shortLinkIp(request)

  // Gate ANTES de BD: agotado el cupo de fallos, esta IP no consulta nada.
  if (missLimiter.limited(ip)) return shortLinkTooManyRequests()

  // Next ya entrega el param percent-decodeado: la doble decodificación
  // puede lanzar URIError con secuencias truncadas. Mismo camino que un
  // código inválido — 404 con registro del fallo.
  let normalized: string
  try {
    normalized = decodeURIComponent(code).trim().toUpperCase()
  } catch {
    missLimiter.register(ip)
    return shortLinkNotFound()
  }

  if (!isCobradorQrCode(normalized)) {
    if (missLimiter.register(ip)) return shortLinkTooManyRequests()
    return shortLinkNotFound()
  }

  // Lista blanca (§4.2 ruta pública): sin sesión ni contexto de tenant.
  const owner = await findPaymentQrOwnerPublic(normalized).catch(() => null)
  if (!owner || !owner.tenantId || owner.tenantStatus !== "active") {
    if (missLimiter.register(ip)) return shortLinkTooManyRequests()
    return shortLinkNotFound()
  }

  // El 302 abre el chat del número DEL TENANT del cobrador (§4.5 2B).
  const waNumber = await resolvePaymentOrderWhatsAppNumber(owner.tenantId)
  if (!waNumber) return shortLinkUnavailable()
  const target = buildPaymentQrWaLink({ code: normalized, number: waNumber })

  if (isPreviewCrawler(request.headers.get("user-agent"))) {
    return previewResponse({ code: normalized, waUrl: target })
  }

  return withShortLinkHeaders(NextResponse.redirect(target, 302))
}
