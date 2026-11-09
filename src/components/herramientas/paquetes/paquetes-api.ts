"use client"

/**
 * Cliente de pago del módulo «Paquetes FlujoTV»: crea las órdenes de paquete
 * con Mercado Pago, transferencia o cupón asignado (1010), y reutiliza el
 * sondeo y el reintento de renovación de `pago-api` — las órdenes de paquete
 * viven en la misma tabla `mp_orders` que las individuales.
 */

import {
  PagoRequestError,
  fetchPaymentOrder,
  requestJson,
  retryOrderRenewal,
  type PaymentOrder,
} from "@/components/entities/pago-api"
import type { PaqueteMonths } from "@/lib/paquetes"

export {
  PagoRequestError,
  fetchPaymentOrder,
  retryOrderRenewal,
  type PaymentOrder,
}

/** Crea la orden del paquete y devuelve el `init_point` del checkout de MP. */
export async function createPaquetePaymentOrder(params: {
  userName: string
  months: PaqueteMonths
}): Promise<{ orderId: string; initPoint: string; amount: number; currency: string }> {
  const data = await requestJson<{
    order_id: string
    init_point: string
    amount: number
    currency: string
  }>("/api/paquetes/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: params.userName,
      months: params.months,
    }),
  })
  return {
    orderId: data.order_id,
    initPoint: data.init_point,
    amount: data.amount,
    currency: data.currency,
  }
}

/**
 * Crea la orden de paquete por transferencia con el ticket adjunto: queda
 * `pending` hasta que el admin apruebe la revisión.
 */
export async function createPaqueteTransferOrder(params: {
  userName: string
  months: PaqueteMonths
  file: File
}): Promise<{ orderId: string; amount: number; currency: string }> {
  const body = new FormData()
  body.set("user_name", params.userName)
  body.set("months", String(params.months))
  body.set("file", params.file)
  const data = await requestJson<{
    order_id: string
    amount: number
    currency: string
  }>("/api/paquetes/transferencias", { method: "POST", body })
  return {
    orderId: data.order_id,
    amount: data.amount,
    currency: data.currency,
  }
}

/**
 * Canjea el cupón asignado del módulo (1010) para el paquete elegido: el
 * servidor valida el código, crea la orden pagada y renueva al instante.
 * Para paquetes la renovación va desacoplada y el status llega `pending`
 * (sondear la orden con `fetchPaymentOrder` hasta verla `renewed`).
 */
export async function createPaqueteCouponOrder(params: {
  userName: string
  months: PaqueteMonths
  /** Id de la intención de canje: igual en reintentos, único por canje. */
  requestId: string
}): Promise<{
  orderId: string
  status: string
  amount: number
  /** Meses pagados de la orden (para etiquetas fieles en el cliente). */
  months: number
  /** Meses gratis de la orden (para etiquetas fieles en el cliente). */
  bonusMonths: number
  error: string | null
  verifiedExpiresAt: string | null
}> {
  return requestJson<{
    order_id: string
    status: string
    amount: number
    months: number
    bonus_months: number
    error: string | null
    verified_expires_at: string | null
  }>("/api/paquetes/cupones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: params.userName,
      months: params.months,
      request_id: params.requestId,
    }),
  }).then((data) => ({
    orderId: data.order_id,
    status: data.status,
    amount: data.amount,
    months: data.months,
    bonusMonths: data.bonus_months,
    error: data.error ?? null,
    verifiedExpiresAt: data.verified_expires_at ?? null,
  }))
}
