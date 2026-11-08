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
  | "refunding"
  | "refunded"

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
  refunded_at: string | null
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
    // El cuerpo no llegó o no es JSON (cuerpo cortado o página de error del
    // proxy): típico cuando el panel de licencias está lento.
    throw new PagoRequestError(
      "El servidor devolvió una respuesta ilegible. Espera unos segundos e inténtalo de nuevo.",
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

/**
 * Envuelve `fetch`: un corte de red antes de respuesta (TypeError) no es una
 * "respuesta ilegible", es un fallo de conectividad con mensaje propio.
 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new PagoRequestError(
      "No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.",
      "network_error"
    )
  }
  return parse<T>(response)
}

/** Crea la orden y devuelve el `init_point` del checkout de Mercado Pago. */
export async function createPaymentOrder(params: {
  userName: string
  months: number
}): Promise<CreatedPaymentOrder> {
  const data = await requestJson<{
    order_id: string
    init_point: string
    amount: number
    currency: string
  }>("/api/mercadopago/orders", {
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

/** Estado actual de una orden, para el sondeo del aviso de retorno. */
export async function fetchPaymentOrder(orderId: string): Promise<PaymentOrder> {
  return requestJson<{ order: PaymentOrder }>(
    `/api/mercadopago/orders/${encodeURIComponent(orderId)}`,
    { cache: "no-store" }
  ).then((data) => data.order)
}

/* --------------------------- Transferencia bancaria ------------------------ */

export interface TransferTicket {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface TransferOrder {
  id: string
  status: PaymentOrderStatus
  user_name: string
  months: number
  amount: number
  currency: string
  buyer_username: string | null
  ticket: TransferTicket | null
  error: string | null
  created_at: string
}

/**
 * Crea la orden de transferencia bancaria con el ticket adjunto: la orden
 * queda `pending` hasta que el admin aprueba la revisión.
 */
export async function createTransferOrder(params: {
  userName: string
  months: number
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
  }>("/api/transferencias/orders", { method: "POST", body })
  return {
    orderId: data.order_id,
    amount: data.amount,
    currency: data.currency,
  }
}

/** Transferencias pendientes de revisión (solo la pide el admin). */
export async function fetchPendingTransferOrders(): Promise<TransferOrder[]> {
  return requestJson<{ orders: TransferOrder[] }>("/api/transferencias/orders", {
    cache: "no-store",
  }).then((data) => data.orders)
}

/** Aprueba una transferencia: renueva la licencia del cliente. */
export async function approveTransferOrder(
  orderId: string
): Promise<{ orderId: string; status: string }> {
  return requestJson<{ order_id: string; status: string }>(
    `/api/transferencias/orders/${encodeURIComponent(orderId)}/approve`,
    { method: "POST" }
  ).then((data) => ({ orderId: data.order_id, status: data.status }))
}

/** Rechaza una transferencia: no hubo pago ni renovación. */
export async function rejectTransferOrder(
  orderId: string,
  reason?: string
): Promise<{ orderId: string; status: string }> {
  return requestJson<{ order_id: string; status: string }>(
    `/api/transferencias/orders/${encodeURIComponent(orderId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    }
  ).then((data) => ({ orderId: data.order_id, status: data.status }))
}

/* --------------------------------- Cupón ---------------------------------- */

/**
 * Renovación pagada con cupón: el servidor valida el código contra los
 * cupones activos y, si es válido, renueva la licencia al instante.
 */
export async function createCouponOrder(params: {
  userName: string
  months: number
  code: string
  /** Id de la intención de canje: igual en reintentos, único por canje. */
  requestId: string
}): Promise<{ orderId: string; status: string; amount: number }> {
  return requestJson<{
    order_id: string
    status: string
    amount: number
  }>("/api/cupones/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: params.userName,
      months: params.months,
      code: params.code,
      request_id: params.requestId,
    }),
  }).then((data) => ({
    orderId: data.order_id,
    status: data.status,
    amount: data.amount,
  }))
}

/**
 * Reintenta la renovación de una orden `renewal_failed` propia (el cupón o
 * pago ya quedó registrado): seguro, la clave determinista de la orden evita
 * sumar meses dos veces.
 */
export async function retryOrderRenewal(
  orderId: string
): Promise<{ orderId: string; status: string }> {
  return requestJson<{ order: { id: string; status: string } }>(
    `/api/mercadopago/orders/${encodeURIComponent(orderId)}/retry`,
    { method: "POST" }
  ).then((data) => ({ orderId: data.order.id, status: data.order.status }))
}

/* ------------------------------- Reembolsos -------------------------------- */

/** Orden de Mercado Pago reembolsable o reembolsada (vista solo admin). */
export interface RefundOrder {
  id: string
  status: PaymentOrderStatus
  user_name: string
  months: number
  amount: number
  currency: string
  payment_id: number | null
  buyer_username: string | null
  error: string | null
  refunded_at: string | null
  created_at: string
  updated_at: string
}

/** Órdenes cobradas por Mercado Pago con renovación fallida (más reembolsadas recientes). */
export async function fetchRefundOrders(): Promise<RefundOrder[]> {
  return requestJson<{ orders: RefundOrder[] }>("/api/reembolsos/orders", {
    cache: "no-store",
  }).then((data) => data.orders)
}

/**
 * Reembolsa el cobro total de una orden con renovación fallida: la orden
 * queda `refunded` (terminal, sin renovación) y el dinero vuelve a la cuenta
 * de Mercado Pago del pagador. `reason` es una nota opcional de auditoría.
 */
export async function refundOrder(
  orderId: string,
  reason?: string
): Promise<{ orderId: string; status: string }> {
  const note = reason?.trim()
  return requestJson<{ order: { id: string; status: string } }>(
    `/api/reembolsos/orders/${encodeURIComponent(orderId)}/refund`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { reason: note } : {}),
    }
  ).then((data) => ({ orderId: data.order.id, status: data.order.status }))
}
