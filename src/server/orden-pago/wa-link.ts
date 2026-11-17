import { whatsappAgentNumber } from "@/server/whatsapp/config"

/*
 * Liga de pago de una orden: `wa.me` al número del AGENTE (donde viven los
 * interceptores que atienden al pagador) con el texto prellenado que lleva
 * el código de concepto. El pagador escanea el QR de la liga (o la abre) y
 * WhatsApp abre el chat con el mensaje listo para enviar.
 */

/** Texto prellenado EXACTO del requerimiento; el código viaja dentro. */
export function paymentOrderWaText(code: string): string {
  return `Realiza tu pago con el código ${code} como concepto de pago y adjunta el comprobante de pago en este chat.`
}

/**
 * Liga `https://wa.me/<agente>?text=<texto prellenado>`. Null = el canal de
 * WhatsApp no está configurado en el servidor (sin `WHATSAPP_AGENT_NUMBER`
 * no hay chat al que apuntar): el módulo bloquea la creación de órdenes.
 */
export function buildPaymentOrderWaLink(code: string): string | null {
  const number = whatsappAgentNumber()
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(
    paymentOrderWaText(code)
  )}`
}
