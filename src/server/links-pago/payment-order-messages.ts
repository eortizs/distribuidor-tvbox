import { paymentOrderConceptoVisible } from "@/lib/links-pago"

import type { PaymentOrder } from "./repository"

/*
 * Mensajes del canal WhatsApp del PAGADOR de una orden de pago que
 * comparten los dos formatos de cobro: el link con importe y concepto
 * definidos por el cobrador (whatsapp.ts) y el QR fijo, donde el pago es
 * libre (qr-fijo.ts). Viven en un módulo propio —sin depender del canal—
 * para que ambos se respondan con el MISMO texto determinista sin ciclos de
 * importación.
 */

export interface PaymentOrderTurnResult {
  /** Primera respuesta para el pagador; vacía = turno manejado sin responder. */
  text: string
  /**
   * Mensajes adicionales ENVIADOS en orden tras `text` (la respuesta de la
   * orden de pago viaja en VARIOS mensajes: instrucciones, el concepto solo y
   * la CLABE sola).
   */
  additionalTexts?: string[]
  /** Orden de pago involucrada, para la bitácora del módulo WhatsApp. */
  orderId: string | null
  /** Texto entrante del turno, para la bitácora. */
  inboundText: string
  mediaMime: string | null
}

export function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

/**
 * Mensaje 1 de la respuesta de un LINK: las INSTRUCCIONES del pago. Texto
 * DETERMINISTA (siempre idéntico, plantilla fija): sentencia del pago con
 * el CONCEPTO DE PAGO de la orden + los datos (importe, banco, CLABE y
 * titular) — la CLABE se imprime aquí para que el pagador sepa a qué refiere
 * el número que llega suelto en el tercer mensaje. En las órdenes de la era
 * previa (sin palabra) el ancla sigue siendo el CÓDIGO del link y el texto
 * lo nombra como tal.
 *
 * La identificación del pagador por el CONCEPTO DE PAGO es MANDATORIA en los
 * links: el comprobante (con el concepto escrito como concepto e impreso en
 * el ticket) es la única evidencia que confirma la orden automáticamente —
 * sin él el pago queda para revisión del creador, aunque el depósito acredite.
 * Así dos cobros del mismo importe (sucursales distintas, sin coordinación
 * de centavos) jamás se confunden de pagador.
 */
export function instruccionesDePago(order: PaymentOrder): string {
  // El concepto se entrega tal como lo escribió el creador
  // (mayúsculas/minúsculas respetadas); el match del escaneo normaliza.
  const concepto = paymentOrderConceptoVisible(order)
  const porPalabra = concepto !== order.code
  const sentencia = porPalabra
    ? `Realiza tu pago SPEI con el concepto de pago *${concepto}* y adjunta el comprobante de pago en este chat para que el sistema pueda validar el pago.`
    : `Realiza tu pago SPEI con el código ${concepto} como *concepto de pago* y adjunta el comprobante de pago en este chat para que el sistema pueda validar el pago.`
  return [
    sentencia,
    "",
    `Importe: ${money(order.amountMxn)}`,
    // En las órdenes de palabra la REFERENCIA es el propio concepto (ya va
    // en la sentencia): el renglón solo agrega contexto en las de la era
    // previa, cuya nota era texto libre.
    !porPalabra && order.note ? `Referencia: ${order.note}` : "",
    "Banco: " + order.bank.bank,
    "CLABE: " + order.bank.account,
    "Titular: " + order.bank.holder,
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

/**
 * Respuesta en TRES mensajes enviados de golpe: 1) instrucciones, 2) el
 * CONCEPTO DE PAGO SOLO y 3) la CLABE SOLO — el concepto y la CLABE viajan
 * sin nada más para que el pagador los copie/pegue con un toque en su app
 * bancaria.
 */
function respuestaDeLink(
  order: PaymentOrder,
  inboundText: string
): PaymentOrderTurnResult {
  return {
    text: instruccionesDePago(order),
    additionalTexts: [paymentOrderConceptoVisible(order), order.bank.account],
    orderId: order.id,
    inboundText,
    mediaMime: null,
  }
}

/**
 * Respuesta con las instrucciones de una orden ACTIVA cuyo código acaba de
 * llegar por el chat. En una orden del QR fijo el pago ya llegó con su
 * comprobante: no se vuelven a pedir ni el concepto ni la transferencia,
 * solo su estado real.
 */
export function respuestaConConcepto(
  order: PaymentOrder,
  inboundText: string
): PaymentOrderTurnResult {
  if (order.origin === "qr") {
    return {
      text:
        order.status === "verifying"
          ? textoVerificandoDeposito(order)
          : `Tu comprobante de ${money(order.amountMxn)} ya quedó registrado y está pendiente: quien te cobró confirmará la recepción y te avisará por este chat. No es necesario volver a enviarlo.`,
      orderId: order.id,
      inboundText,
      mediaMime: null,
    }
  }
  return respuestaDeLink(order, inboundText)
}

/** Estado de una orden EN VERIFICACIÓN de depósito (replay honesto). */
export function textoVerificandoDeposito(order: PaymentOrder): string {
  return [
    `Tu pago de la orden *${order.code}* (${money(order.amountMxn)}) está *en verificación*: el comprobante ya pasó la validación y estamos confirmando la acreditación del depósito en la cuenta.`,
    "",
    "Te avisaremos aquí mismo en cuanto se confirme (suele tardar minutos; según tu banco puede tardar más). No es necesario reenviar el comprobante.",
  ].join("\n")
}

/**
 * Replay honesto del estado de una orden ya resuelta, cancelada o en
 * verificación. Lo comparten el canal de los links y el pago libre del QR
 * fijo; en este el comprobante ya llegó, así que nunca se pide uno nuevo.
 */
export function textoEstadoResuelto(order: PaymentOrder): string {
  const pago = `Tu pago de la orden *${order.code}* (${money(order.amountMxn)})`
  const revisar = "Si tu pago fue real, contacta a quien te cobró para revisar el caso."
  switch (order.status) {
    case "verifying":
      return textoVerificandoDeposito(order)
    case "paid":
      if (order.origin === "qr") {
        return `${pago} ya está confirmado. No es necesario volver a enviar el comprobante.`
      }
      return [
        `El link de pago *${order.code}* ya está pagado`,
        order.resolvedAt ? `(confirmada el ${new Date(order.resolvedAt).toLocaleString("es-MX")})` : "",
        ". No es necesario volver a enviar el comprobante.",
      ]
        .filter((line) => line.length > 0)
        .join(" ")
    case "rejected":
      return order.origin === "qr"
        ? `${pago} fue rechazado. ${revisar}`
        : `El link de pago *${order.code}* fue rechazado. Si tu pago fue real, contacta a quien te emitió la orden para revisar el caso.`
    case "cancelled":
      return order.origin === "qr"
        ? `${pago} fue cancelado. ${revisar}`
        : `El link de pago *${order.code}* fue cancelado y el código ya no está activo. Pide un link de pago nuevo.`
    default:
      return `El link de pago *${order.code}* ya no está activo (estado: ${order.status}).`
  }
}

/**
 * PRIMER respuesta del QR fijo (pago libre): las INSTRUCCIONES en pasos
 * claros + los datos de la cuenta. El pagador transfiere el monto que
 * quiera —el concepto es libre— y envía su comprobante; de ahí sale el cobro.
 * La respuesta viaja en DOS mensajes: estas instrucciones y la CLABE SOLO
 * (copiar/pegar); la arma el canal.
 */
export function instruccionesQrPagoLibre(bank: PaymentOrder["bank"]): string {
  return [
    "Para pagar sigue estos pasos:",
    "",
    "1. Haz una transferencia SPEI por el *monto que quieras* a esta cuenta. El concepto de pago es libre.",
    "2. Envía en este chat la FOTO o el PDF de tu comprobante.",
    "3. Recibirás aquí la confirmación de tu pago.",
    "",
    "Banco: " + bank.bank,
    "CLABE: " + bank.account,
    "Titular: " + bank.holder,
  ].join("\n")
}
