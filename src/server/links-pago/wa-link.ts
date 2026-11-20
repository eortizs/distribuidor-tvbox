import { shortLinkBaseUrl } from "@/server/site-url"
import { whatsappAgentNumber } from "@/server/whatsapp/config"

/*
 * Links de pago (SPEILink) de una orden (payment_orders): el dominio corto
 * `spei.link/<CÓDIGO>` —el CÓDIGO es el mismo código de concepto de la
 * orden— es el link que se comparte y codifica el QR. Abierto, el shortener
 * redirige (302) a `wa.me` con el texto prellenado de SOLICITUD al número
 * del AGENTE (donde viven los interceptores que atienden al pagador);
 * WhatsApp abre el chat con el mensaje listo para enviar y el agente
 * responde el CÓDIGO de concepto y las instrucciones SPEI.
 */

/** Alfabeto de códigos sin ambigüedad (32 símbolos, sin 0/O/1/I). */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/

/** True si el texto tiene la forma exacta de un código de concepto. */
export function isPaymentLinkCode(code: string): boolean {
  return CODE_PATTERN.test(code)
}

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

/** Texto prellenado EXACTO: el pagador solicita el link por su monto. */
export function paymentOrderWaText(amountMxn: number): string {
  return `Solicito un link de pago por ${money(amountMxn)}`
}

/** Link corto de la orden: el dominio corto + su código de concepto. */
export function buildPaymentOrderShortLink(code: string): string {
  return `${shortLinkBaseUrl()}/${code}`
}

/**
 * Link `https://wa.me/<agente>?text=<texto prellenado>`, destino del 302 del
 * shortener. Null = el canal de WhatsApp no está configurado en el servidor
 * (sin `WHATSAPP_AGENT_NUMBER` no hay chat al que apuntar): el módulo
 * bloquea la creación de links.
 */
export function buildPaymentOrderWaLink(amountMxn: number): string | null {
  const number = whatsappAgentNumber()
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(
    paymentOrderWaText(amountMxn)
  )}`
}
