"use client"

/**
 * Cliente de pago del módulo «Abonar saldo»: crea las órdenes de abono con
 * Mercado Pago, transferencia o cupón QA (0000), y reutiliza el sondeo y el
 * reintento de `pago-api` — las órdenes de abono viven en la misma tabla
 * `mp_orders` que las renovaciones (con `months = 0` como marca).
 */

import {
  PagoRequestError,
  fetchPaymentOrder,
  requestJson,
  retryOrderRenewal,
  createTransferConcept,
  type PaymentOrder,
  type TransferConcept,
} from "@/components/entities/pago-api"
import type { AbonoAmountOk, SaldoTipo } from "@/lib/saldo"

export {
  PagoRequestError,
  fetchPaymentOrder,
  retryOrderRenewal,
  createTransferConcept,
  type PaymentOrder,
  type TransferConcept,
}

/** Crea la orden de abono y devuelve el `init_point` del checkout de MP. */
export async function createSaldoPaymentOrder(params: {
  /** Monto definido por el comprador, ya validado (`parseAbonoAmount`). */
  amount: AbonoAmountOk["amount"]
  /** Billetera destino del abono: tokens o cupones. */
  tipo: SaldoTipo
}): Promise<{
  orderId: string
  initPoint: string
  /** Total engrosado a cobrar con Mercado Pago. */
  amount: number
  /** Monto que se acreditará al saldo. */
  creditAmount: number
  currency: string
}> {
  const data = await requestJson<{
    order_id: string
    init_point: string
    amount: number
    credit_amount: number
    currency: string
  }>("/api/saldo/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: params.amount, tipo: params.tipo }),
  })
  return {
    orderId: data.order_id,
    initPoint: data.init_point,
    amount: data.amount,
    creditAmount: data.credit_amount,
    currency: data.currency,
  }
}

/**
 * Crea la orden de abono por transferencia con el ticket adjunto y el
 * concepto de pago del paso 1: queda `pending` (o se autoriza sola si el
 * escaneo del comprobante pasa) y el saldo se acredita al aprobarse.
 */
export async function createSaldoTransferOrder(params: {
  amount: AbonoAmountOk["amount"]
  /** Billetera destino del abono: tokens o cupones. */
  tipo: SaldoTipo
  concepto: string
  file: File
}): Promise<{
  orderId: string
  amount: number
  currency: string
  review?: "auto_approved" | "auto_rejected" | "manual"
  reasons?: string[]
}> {
  const body = new FormData()
  body.set("amount", String(params.amount))
  body.set("tipo", params.tipo)
  body.set("concepto", params.concepto)
  body.set("file", params.file)
  const data = await requestJson<{
    order_id: string
    amount: number
    currency: string
    review?: "auto_approved" | "auto_rejected" | "manual"
    status?: string
    reasons?: string[]
  }>("/api/saldo/transferencias", { method: "POST", body })
  return {
    orderId: data.order_id,
    amount: data.amount,
    currency: data.currency,
    review: data.review,
    reasons: data.reasons ?? [],
  }
}

/**
 * Canjea el cupón QA (0000) para el abono: el servidor valida el código y
 * los topes por comprador, registra la orden pagada y acredita el saldo al
 * instante. Idempotente por `requestId`.
 */
export async function createSaldoCouponOrder(params: {
  amount: AbonoAmountOk["amount"]
  /** Billetera destino del abono: tokens o cupones. */
  tipo: SaldoTipo
  code: string
  requestId: string
}): Promise<{
  orderId: string
  status: string
  amount: number
  saldo: number | null
  error: string | null
}> {
  return requestJson<{
    order_id: string
    status: string
    amount: number
    currency: string
    saldo: number | null
    error: string | null
  }>("/api/saldo/cupones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: params.amount,
      tipo: params.tipo,
      code: params.code,
      request_id: params.requestId,
    }),
  }).then((data) => ({
    orderId: data.order_id,
    status: data.status,
    amount: data.amount,
    saldo: data.saldo ?? null,
    error: data.error ?? null,
  }))
}
