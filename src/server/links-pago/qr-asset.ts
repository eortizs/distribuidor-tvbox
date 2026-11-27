import QRCode from "qrcode"

import {
  buildPaymentQrShortLink,
  buildPaymentQrWaLink,
  resolvePaymentOrderWhatsAppNumber,
} from "./wa-link"

/*
 * QR FIJO de cobro — los datos que pinta el módulo (/modulos/links-de-pago):
 * el código del cobrador, el link corto que codifica el QR, el link wa.me
 * con la solicitud prellenada y la imagen del QR. Lo comparten la página
 * (que ya trae el QR armado para quien tiene código) y la acción que lo
 * asigna por primera vez.
 */

export interface PaymentQrLink {
  code: string
  /** Link corto `spei.link/cobro/<código>`: lo que codifica el QR. */
  shortUrl: string
  /** Link wa.me con la solicitud prellenada: destino del shortener. */
  waUrl: string
  qrDataUrl: string
}

/**
 * Tamaño del QR en px: se muestra a ~240 y se imprime, así que se rasteriza
 * al doble para que no se vea borroso ni en pantalla de alta densidad ni en
 * el archivo que descarga el cobrador.
 */
const QR_IMAGE_WIDTH = 480

/**
 * Caché por (código, número de WhatsApp): el código de un cobrador es
 * permanente y el link corto no cambia, así que el PNG se codifica UNA vez.
 * La página del módulo se vuelve a renderizar con cada evento de tiempo real
 * (y cada sondeo de depósito); sin caché repetía ~20 ms de CPU en el hilo
 * principal por render para la misma imagen.
 */
const QR_CACHE_MAX = 500
const qrCache = new Map<string, PaymentQrLink>()

/**
 * Arma el QR fijo de un código. Null = el negocio no tiene número de
 * WhatsApp (no hay chat al que apuntar: el link no serviría).
 */
export async function renderPaymentQrLink(
  code: string,
  tenantId: string | null
): Promise<PaymentQrLink | null> {
  const waNumber = await resolvePaymentOrderWhatsAppNumber(tenantId)
  if (!waNumber) return null
  const cacheKey = `${code}:${waNumber}`
  const cached = qrCache.get(cacheKey)
  if (cached) return cached

  const shortUrl = buildPaymentQrShortLink(code)
  // Corrección 'Q': el QR se imprime y se maltrata (se admite ~25 % de
  // módulos dañados); con un link tan corto no cuesta densidad respecto de 'M'.
  const qrDataUrl = await QRCode.toDataURL(shortUrl, {
    margin: 2,
    width: QR_IMAGE_WIDTH,
    errorCorrectionLevel: "Q",
  })
  const link: PaymentQrLink = {
    code,
    shortUrl,
    waUrl: buildPaymentQrWaLink({ code, number: waNumber }),
    qrDataUrl,
  }
  if (qrCache.size >= QR_CACHE_MAX) {
    const oldest = qrCache.keys().next().value
    if (oldest !== undefined) qrCache.delete(oldest)
  }
  qrCache.set(cacheKey, link)
  return link
}
