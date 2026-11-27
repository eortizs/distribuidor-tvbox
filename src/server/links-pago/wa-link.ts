import {
  cobradorQrRequestText,
  cobradorQrShortPath,
  paymentOrderRequestText,
} from "@/lib/links-pago"
import { shortLinkBaseUrl } from "@/server/site-url"
import { whatsappAgentNumber } from "@/server/whatsapp/config"
import { LEGACY_TENANT_ID } from "@/server/tenant/identity"
import { findTenantById } from "@/server/tenant/context"

/*
 * Links de pago (SPEILink) de una orden (payment_orders): el dominio corto
 * `spei.link/<CÓDIGO>` —el CÓDIGO es el mismo código de concepto de la
 * orden— es el link que se comparte y codifica el QR. Abierto, el shortener
 * redirige (302) a `wa.me` con el texto prellenado de SOLICITUD al número
 * del negocio (donde viven los interceptores que atienden al pagador); el
 * texto lleva el IMPORTE y el CÓDIGO del link, así que WhatsApp abre el chat
 * con el mensaje listo para enviar y el canal identifica ESA orden y le
 * responde el CONCEPTO DE PAGO y las instrucciones de transferencia.
 *
 * El QR FIJO de cobro es el otro shortener del dominio:
 * `spei.link/cobro/<CÓDIGO>` apunta al QR permanente de UN cobrador; su
 * mensaje inicial solo trae la solicitud y el código de cobrador, porque
 * el importe y el concepto los declara el pagador en el chat.
 */

/** Link corto de la orden: el dominio corto + su código de concepto. */
export function buildPaymentOrderShortLink(code: string): string {
  return `${shortLinkBaseUrl()}/${code}`
}

/** Link corto del QR FIJO de cobro: el dominio corto + `/cobro/` + su código. */
export function buildPaymentQrShortLink(code: string): string {
  return `${shortLinkBaseUrl()}${cobradorQrShortPath(code)}`
}

/**
 * Número de WhatsApp que atiende los pagos del tenant (§4.5 2B): el legado
 * usa el del env (el socket TVBox); un negocio el número que declaró en su
 * asistente. Null = sin canal: no se puede crear un link (no hay chat al
 * que apuntar).
 */
export async function resolvePaymentOrderWhatsAppNumber(
  tenantId: string | null
): Promise<string | null> {
  if (!tenantId) return null
  if (tenantId === LEGACY_TENANT_ID) return whatsappAgentNumber()
  const tenant = await findTenantById(tenantId).catch(() => null)
  return tenant?.whatsappNumber ?? null
}

/**
 * Link `https://wa.me/<número>?text=<texto prellenado>`, destino del 302 del
 * shortener (y del botón de apertura del diálogo). El número lo resuelve el
 * llamador con `resolvePaymentOrderWhatsAppNumber` ANTES de crear la orden —
 * el link de un negocio abre el chat de SU número, jamás el del legado.
 */
export function buildPaymentOrderWaLink(input: {
  amountMxn: number
  code: string
  number: string
}): string {
  return `https://wa.me/${input.number}?text=${encodeURIComponent(
    paymentOrderRequestText(input.amountMxn, input.code)
  )}`
}

/**
 * Igual que `buildPaymentOrderWaLink`, para el QR fijo: abre el chat con la
 * solicitud «Solicito realizar un pago. (cobrador XXXXXX)».
 */
export function buildPaymentQrWaLink(input: {
  code: string
  number: string
}): string {
  return `https://wa.me/${input.number}?text=${encodeURIComponent(
    cobradorQrRequestText(input.code)
  )}`
}
