import { whatsappAgentNumber } from "@/server/whatsapp/config"

/*
 * Liga de pago de una orden: `wa.me` al número del AGENTE (donde viven los
 * interceptores que atienden al pagador) con el texto prellenado de
 * SOLICITUD. El pagador escanea el QR de la liga (o la abre) y WhatsApp
 * abre el chat con el mensaje listo para enviar; el agente responde el
 * CÓDIGO de concepto de la orden (un mensaje con el código solo, para
 * copiar/pegar fácil) y las instrucciones SPEI.
 */

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

/** Texto prellenado EXACTO: el pagador solicita la orden por su monto. */
export function paymentOrderWaText(amountMxn: number): string {
  return `Solicito una orden de pago por ${money(amountMxn)}`
}

/**
 * Liga `https://wa.me/<agente>?text=<texto prellenado>`. Null = el canal de
 * WhatsApp no está configurado en el servidor (sin `WHATSAPP_AGENT_NUMBER`
 * no hay chat al que apuntar): el módulo bloquea la creación de órdenes.
 */
export function buildPaymentOrderWaLink(amountMxn: number): string | null {
  const number = whatsappAgentNumber()
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(
    paymentOrderWaText(amountMxn)
  )}`
}
