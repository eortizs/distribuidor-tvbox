"use client"

/**
 * Cliente de pago para /clientes: crea la orden con Mercado Pago y sondea su
 * estado tras el retorno del checkout. Envoltorio y errores idénticos al
 * resto de clientes de API del panel (`{ ok, data, error }`).
 */

export type PaymentOrderStatus =
  | "pending"
  | "paid"
  | "renewed"
  | "renewal_failed"
  | "rejected"
  | "cancelled"

export interface PaymentOrder {
  id: string
  status: PaymentOrderStatus
  user_name: string
  months: number
  amount: number
  currency: string
  payment_id: number | null
  payment_status: string | null
  error: string | null
  renewed_at: string | null
  created_at: string
  updated_at: string
}

export interface CreatedPaymentOrder {
  orderId: string
  initPoint: string
  amount: number
  currency: string
}

export class PagoRequestError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = "PagoRequestError"
    this.code = code
  }
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

async function parse<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T>
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new PagoRequestError(
      "El servidor devolvió una respuesta ilegible.",
      "invalid_response"
    )
  }

  if (!payload.ok || payload.data === undefined) {
    throw new PagoRequestError(
      payload.error?.message ?? "La solicitud de pago falló.",
      payload.error?.code ?? "unknown_error"
    )
  }

  return payload.data
}

/** Crea la orden y devuelve el `init_point` del checkout de Mercado Pago. */
export async function createPaymentOrder(params: {
  userName: string
  months: number
}): Promise<CreatedPaymentOrder> {
  const response = await fetch("/api/mercadopago/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: params.userName,
      months: params.months,
    }),
  })
  const data = await parse<{
    order_id: string
    init_point: string
    amount: number
    currency: string
  }>(response)
  return {
    orderId: data.order_id,
    initPoint: data.init_point,
    amount: data.amount,
    currency: data.currency,
  }
}

/** Estado actual de una orden, para el sondeo del aviso de retorno. */
export async function fetchPaymentOrder(orderId: string): Promise<PaymentOrder> {
  const response = await fetch(
    `/api/mercadopago/orders/${encodeURIComponent(orderId)}`,
    { cache: "no-store" }
  )
  return parse<{ order: PaymentOrder }>(response).then((data) => data.order)
}
