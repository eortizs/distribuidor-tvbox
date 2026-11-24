import { paymentOrderRequestText } from "@/lib/links-pago"
import { shortLinkBaseUrl } from "@/server/site-url"
import { whatsappAgentNumber } from "@/server/whatsapp/config"

/*
 * Links de pago (SPEILink) de una orden (payment_orders): el dominio corto
 * `spei.link/<CÓDIGO>` —el CÓDIGO es el mismo código de concepto de la
 * orden— es el link que se comparte y codifica el QR. Abierto, el shortener
 * redirige (302) a `wa.me` con el texto prellenado de SOLICITUD al número
 * del AGENTE (donde viven los interceptores que atienden al pagador); el
 * texto lleva el IMPORTE y el CÓDIGO del link, así que WhatsApp abre el chat
 * con el mensaje listo para enviar y el agente identifica ESA orden y le
 * responde el CONCEPTO DE PAGO y las instrucciones de transferencia.
 */

/** Link corto de la orden: el dominio corto + su código de concepto. */
export function buildPaymentOrderShortLink(code: string): string {
  return `${shortLinkBaseUrl()}/${code}`
}

/**
 * Link `https://wa.me/<agente>?text=<texto prellenado>`, destino del 302 del
 * shortener (y del botón de apertura del diálogo). Null = el canal de
 * WhatsApp no está configurado en el servidor (sin `WHATSAPP_AGENT_NUMBER`
 * no hay chat al que apuntar): el módulo bloquea la creación de links.
 */
export function buildPaymentOrderWaLink(order: {
  amountMxn: number
  code: string
}): string | null {
  const number = whatsappAgentNumber()
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(
    paymentOrderRequestText(order.amountMxn, order.code)
  )}`
}
