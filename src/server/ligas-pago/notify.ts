import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"

import type { PaymentOrder } from "./repository"

/*
 * Avisos de DEPÓSITO CONFIRMADO de una orden de pago: campana al creador
 * (con espejo WhatsApp) + WhatsApp directo al pagador si su teléfono está
 * ligado. Viven en un módulo propio (sin depender del flujo de revisión del
 * comprobante) para que TODOS los confirmadores los compartan sin ciclos de
 * importación: el chequeo inmediato y el verificador en background
 * (deposit-verifier.ts, carriles verifying y pending) y la rama webhook de
 * depósitos (mercadopago/service.ts → deposit-check.ts).
 */

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

/** Aviso al creador por campana (con espejo WhatsApp); nunca lanza. */
export function notifyCreator(
  order: PaymentOrder,
  title: string,
  body: string
): void {
  createPaymentOrderNotification({
    userId: order.creatorUserId,
    orderId: order.id,
    title,
    body,
  })
}

/** Confirmación DIRECTA al pagador por WhatsApp; nunca lanza. */
function notifyPayer(order: PaymentOrder, title: string, body: string): void {
  if (!order.payerPhone) return
  void enqueueWhatsAppForPhone({
    userId: order.creatorUserId,
    phone: order.payerPhone,
    kind: WHATSAPP_KIND_PAYMENT_ORDER,
    title,
    body,
  })
}

/**
 * Depósito confirmado CON comprobante (chequeo inmediato del turno y
 * verificador del carril 'verifying'): los textos mencionan el comprobante
 * validado.
 */
export function notifyDepositConfirmed(order: PaymentOrder): void {
  const pagador = order.payerPhone ? ` (WhatsApp ${maskPhone(order.payerPhone)})` : ""
  const deposito = order.mpDepositAt
    ? ` acreditado el ${new Date(order.mpDepositAt).toLocaleString("es-MX")}`
    : ""
  notifyCreator(
    order,
    "Cobro confirmado por depósito",
    `El pagador${pagador} de tu orden ${order.code} pagó ${money(
      order.amountMxn
    )}: el comprobante pasó la validación automática (concepto e importe) y el depósito quedó acreditado en tu cuenta${deposito}.`
  )
  notifyPayer(
    order,
    "Pago confirmado",
    `Recibimos tu comprobante y confirmamos el depósito de ${money(
      order.amountMxn
    )} con el código ${order.code} en la cuenta. Tu pago quedó validado. Gracias.`
  )
}

/**
 * Depósito confirmado SIN comprobante (carril `pending` del verificador y
 * rama webhook): el depósito acreditado confirmó la orden por importe +
 * ventana con coincidencia única — nadie envió comprobante, así que los
 * textos no lo mencionan. Sin teléfono ligado solo se avisa al creador.
 */
export function notifyDepositAutoConfirmed(order: PaymentOrder): void {
  const pagador = order.payerPhone ? ` (WhatsApp ${maskPhone(order.payerPhone)})` : ""
  const deposito = order.mpDepositAt
    ? ` acreditado el ${new Date(order.mpDepositAt).toLocaleString("es-MX")}`
    : ""
  notifyCreator(
    order,
    "Cobro confirmado automáticamente",
    `El pagador${pagador} de tu orden ${order.code} pagó ${money(
      order.amountMxn
    )}: el depósito quedó acreditado en tu cuenta${deposito} y la liga se marcó pagada automáticamente (sin comprobante: casado por importe y acreditación en tu cuenta).`
  )
  notifyPayer(
    order,
    "Pago confirmado",
    `Confirmamos automáticamente el depósito de ${money(
      order.amountMxn
    )} con el código ${order.code} en la cuenta. Tu pago quedó validado y no necesitas enviar comprobante. Gracias.`
  )
}
