import { NextResponse, connection, type NextRequest } from "next/server"
import { runWithTenant } from "@/server/tenant/context"

import { paymentOrderMoney, isPaymentLinkCode } from "@/lib/links-pago"
import { buildPaymentOrderOgHtml, isPreviewCrawler } from "@/lib/links-pago-og"
import {
  findPendingPaymentOrderByAnyCode,
  findResolvedPaymentOrderByAnyCode,
  markPaymentOrderLinkOpened,
} from "@/server/links-pago/repository"
import {
  createMissLimiter,
  shortLinkIp,
  shortLinkNotFound,
  shortLinkPage,
  shortLinkTooManyRequests,
  shortLinkUnavailable,
  withShortLinkHeaders,
} from "@/server/links-pago/short-link-guard"
import { shortLinkBaseUrl } from "@/server/site-url"
import {
  buildPaymentOrderShortLink,
  buildPaymentOrderWaLink,
  resolvePaymentOrderWhatsAppNumber,
} from "@/server/links-pago/wa-link"

/*
 * Shortener de links de pago (spei.link/<CÓDIGO>): el CÓDIGO es el mismo
 * código de concepto de la orden (payment_orders). El proxy reescribe aquí
 * las peticiones cuyo host es el dominio corto (SPEI_LINK_BASE_URL), así
 * que esta ruta no requiere sesión y solo se alcanza por ese host.
 *
 *   - código ACTIVO (pending | verifying) → 302 a wa.me con la SOLICITUD
 *     prellenada (importe + CÓDIGO del link: el agente identifica esa orden
 *     aunque haya otras pendientes del mismo importe; el pagador aterriza
 *     en el chat del agente, igual que con el link wa.me de siempre). Los
 *     lookups reusan las puertas del canal
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
 * Cabeceras, páginas y anti-enumeración (30 códigos fallidos/min por IP
 * real): compartidas con el shortener del QR fijo en
 * src/server/links-pago/short-link-guard.ts.
 *
 * El QR FIJO de cobro tiene su propio shortener en src/app/short/cobro.
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
  // el redirect congelado (patrón /api/auth/google/*).
  await connection()

  const { code } = await params
  const ip = shortLinkIp(request)

  // Gate ANTES de BD: agotado el cupo de fallos, esta IP no consulta nada.
  if (missLimiter.limited(ip)) return shortLinkTooManyRequests()

  // Next ya entrega el param percent-decodeado: la doble decodificación
  // puede lanzar URIError con secuencias truncadas (p. ej. "/short/%").
  // Mismo camino que un código inválido — 404 con registro del fallo.
  let normalized: string
  try {
    normalized = decodeURIComponent(code).trim().toUpperCase()
  } catch {
    missLimiter.register(ip)
    return shortLinkNotFound()
  }

  if (!isPaymentLinkCode(normalized)) {
    if (missLimiter.register(ip)) return shortLinkTooManyRequests()
    return shortLinkNotFound()
  }

  // Activas primero (el índice único parcial las cubre): un código que hoy
  // tiene orden viva redirige aunque una resuelta vieja lo haya tenido.
  const order = await findPendingPaymentOrderByAnyCode([normalized]).catch(
    () => null
  )
  if (order) {
    // El 302 abre el chat del número DEL TENANT de la orden (§4.5 2B): el
    // link de un negocio redirige al WhatsApp de su negocio; el del legado,
    // al del env. Bajo el contexto del tenant (la lectura del número consulta
    // la fila con su RLS… por systemPool vía findTenantById, así que el
    // wrapper solo aporta el GUC del pagador anónimo: innecesario aquí).
    const waNumber = await resolvePaymentOrderWhatsAppNumber(order.tenantId)
    const target = waNumber
      ? buildPaymentOrderWaLink({
          amountMxn: order.amountMxn,
          code: order.code,
          number: waNumber,
        })
      : null
    if (!target) return shortLinkUnavailable()

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
    return withShortLinkHeaders(NextResponse.redirect(target, 302))
  }

  // Sin activa: ¿el código corresponde a una orden YA resuelta? 410 honesto
  // en lugar del 404 genérico (replay del estado sin revelar datos).
  const resolved = await findResolvedPaymentOrderByAnyCode([normalized]).catch(
    () => null
  )
  if (resolved) {
    return shortLinkPage(
      410,
      "Link ya no activo",
      "Este enlace de pago ya fue resuelto. Pide un link nuevo a quien te lo compartió."
    )
  }

  if (missLimiter.register(ip)) return shortLinkTooManyRequests()
  return shortLinkNotFound()
}
