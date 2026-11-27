import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import { runWithTenant } from "@/server/tenant/context"
import { paymentOrderConceptoVisible } from "@/lib/links-pago"

import type { PaymentOrder } from "./repository"

/*
 * Avisos de DEPÓSITO CONFIRMADO de una orden de pago: campana al creador
 * (con espejo WhatsApp) + WhatsApp directo al pagador si su teléfono está
 * ligado. Viven en un módulo propio (sin depender del flujo de revisión del
 * comprobante) para que TODOS los confirmadores los compartan sin ciclos de
 * importación: el chequeo inmediato y el verificador en background
 * (deposit-verifier.ts) y la rama webhook de depósitos (mercadopago/
 * service.ts → deposit-check.ts). Toda confirmación lleva comprobante
 * validado (la identificación del pagador por código es mandatoria).
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
 * El pagador contactó (primer binding de su teléfono: recibió el código y
 * la CLABE por WhatsApp). Campana SOLO al creador — el pagador ya está en
 * el chat y su confirmación fluye por ahí. Se dispara UNA vez por orden
 * (`touchPaymentOrderPayer` devuelve true solo en el primer binding).
 */
export function notifyPayerContacted(order: PaymentOrder, phone: string): void {
  notifyCreator(
    order,
    "Pagador en contacto",
    `El pagador (WhatsApp ${maskPhone(phone)}) abrió tu link ${order.code} (${money(
      order.amountMxn
    )}) y recibió el concepto de pago ${paymentOrderConceptoVisible(order)} y la CLABE. Te avisaremos cuando envíe su comprobante o cuando el pago se confirme.`
  )
}

/**
 * Depósito confirmado CON comprobante validado (chequeo inmediato del
 * turno, verificador del carril 'verifying' y barrido/webhook — toda
 * confirmación pasa por el comprobante): los textos lo mencionan.
 *
 * El aviso corre bajo el tenant de la ORDEN (§4.5 2A): desde el barrido
 * cross-tenant llega bajo `runAsPlatform`, donde el GUC de tenant no existe
 * — el trigger dejaría `tenant_id` NULL y los INSERTs en `notifications`/
 * `wa_outbox` fallarían en silencio.
 */
export function notifyDepositConfirmed(order: PaymentOrder): void {
  void runWithTenant(order.tenantId, async () => {
    notifyDepositConfirmedInTenant(order)
  }).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `links_pago: notify_deposit_confirmed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  })
}

function notifyDepositConfirmedInTenant(order: PaymentOrder): void {
  const pagador = order.payerPhone ? ` (WhatsApp ${maskPhone(order.payerPhone)})` : ""
  const deposito = order.mpDepositAt
    ? ` acreditado el ${new Date(order.mpDepositAt).toLocaleString("es-MX")}`
    : ""
  // En el pago libre del QR fijo no hubo concepto que validar.
  const libre = order.origin === "qr"
  notifyCreator(
    order,
    "Cobro confirmado por depósito",
    `El pagador${pagador} de tu orden ${order.code} pagó ${money(
      order.amountMxn
    )}: el comprobante pasó la validación automática (${libre ? "importe" : "concepto e importe"}) y el depósito quedó acreditado en tu cuenta${deposito}.`
  )
  notifyPayer(
    order,
    "Pago confirmado",
    `Recibimos tu comprobante y confirmamos el depósito de ${money(
      order.amountMxn
    )}${libre ? "" : ` con el concepto de pago ${paymentOrderConceptoVisible(order)}`} en la cuenta. Tu pago quedó validado. Gracias.`
  )
}
