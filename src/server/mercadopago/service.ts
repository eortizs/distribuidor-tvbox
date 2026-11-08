import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { renewFlujoLicense } from "@/server/flujotv/service"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { isRenewalMonths, type RenewalMonths } from "@/lib/flujotv"

import { resolveMercadoPagoConfig, isCouponQaEnabled, couponQaDailyLimit } from "./config"
import { mercadoPagoRequest } from "./client"
import { MercadoPagoError } from "./errors"

/* -------------------------------------------------------------------------- */
/*                                  Tipos                                     */
/* -------------------------------------------------------------------------- */

export type MpOrderStatus =
  | "pending"
  | "paid"
  | "renewed"
  | "renewal_failed"
  | "rejected"
  | "cancelled"

export type MpOrderMethod = "mercadopago" | "transferencia" | "cupon"

export interface MpOrderRow {
  id: string
  status: MpOrderStatus
  method: MpOrderMethod
  user_name: string
  months: number
  amount: number
  currency: string
  buyer_user_id: string | null
  preference_id: string | null
  payment_id: number | null
  payment_status: string | null
  ticket_file_id: string | null
  coupon_code: string | null
  error: string | null
  renewed_at: string | null
  created_at: string
  updated_at: string
}

export interface MpOrderPublic {
  id: string
  status: MpOrderStatus
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

interface MpPaymentPayload {
  id?: unknown
  status?: unknown
  status_detail?: unknown
  external_reference?: unknown
  transaction_amount?: unknown
  currency_id?: unknown
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Una orden pendiente más vieja que esto intenta conciliarse al consultarse. */
const RECONCILE_AFTER_MS = 90_000

/**
 * Una orden `paid` cuya renovación lleva más tiempo que esto se considera
 * varada (un crash o deploy cortó el proceso entre el cobro y la renovación):
 * la conciliación reintenta la renovación al consultarse. Es seguro: la clave
 * de idempotencia determinista evita duplicar meses.
 */
const STUCK_PAID_AFTER_MS = 10 * 60_000

function log(event: string, fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({ ts: new Date().toISOString(), event, ...fields })
  )
}

function logError(context: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `mercadopago: ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Señal de invalidación para las sesiones conectadas (SSE): un cambio de
 * estado de orden puede reflejar una licencia renovada en la pantalla de
 * clientes de otro dispositivo. Mejor esfuerzo, nunca bloquea la respuesta.
 */
function notifyOrderChange(orderId: string): void {
  publishRealtimeDetached({ kind: "mp_order", entityId: orderId })
}

/* -------------------------------------------------------------------------- */
/*                              Lectura de órdenes                             */
/* -------------------------------------------------------------------------- */

function parseRow(row: Record<string, unknown>): MpOrderRow {
  return {
    id: String(row.id),
    status: String(row.status) as MpOrderStatus,
    method:
      row.method === "transferencia"
        ? "transferencia"
        : row.method === "cupon"
          ? "cupon"
          : "mercadopago",
    user_name: String(row.user_name),
    months: Number(row.months),
    amount: Number(row.amount),
    currency: String(row.currency),
    buyer_user_id: row.buyer_user_id === null ? null : String(row.buyer_user_id),
    preference_id: row.preference_id === null ? null : String(row.preference_id),
    payment_id: row.payment_id === null ? null : Number(row.payment_id),
    payment_status: row.payment_status === null ? null : String(row.payment_status),
    ticket_file_id:
      row.ticket_file_id === null || row.ticket_file_id === undefined
        ? null
        : String(row.ticket_file_id),
    coupon_code:
      row.coupon_code === null || row.coupon_code === undefined
        ? null
        : String(row.coupon_code),
    error: row.error === null ? null : String(row.error),
    renewed_at:
      row.renewed_at === null ? null : new Date(row.renewed_at as string).toISOString(),
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  }
}

/** Proyección pública: sin buyer_user_id (dato interno del comprador). */
export function toMpOrderPublic(row: MpOrderRow): MpOrderPublic {
  return {
    id: row.id,
    status: row.status,
    user_name: row.user_name,
    months: row.months,
    amount: row.amount,
    currency: row.currency,
    payment_id: row.payment_id,
    payment_status: row.payment_status,
    error: row.error,
    renewed_at: row.renewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getMpOrder(orderId: string): Promise<MpOrderRow | null> {
  if (!UUID_RE.test(orderId)) return null
  const result = await pool.query("SELECT * FROM mp_orders WHERE id = $1", [
    orderId,
  ])
  const row = result.rows[0]
  return row ? parseRow(row) : null
}

/* -------------------------------------------------------------------------- */
/*                          Creación de la orden de pago                       */
/* -------------------------------------------------------------------------- */

export interface CreatePaymentOrderResult {
  orderId: string
  initPoint: string
  amount: number
  currency: string
}

/**
 * Crea la orden `pending` y la preferencia de Mercado Pago con
 * `purpose: wallet_purchase` (solo usuarios con cuenta de Mercado Pago, pago
 * wallet a wallet). El importe queda congelado en la orden: el webhook
 * verifica contra ella, nunca contra datos del navegador.
 */
export async function createPaymentOrder(params: {
  userName: string
  months: RenewalMonths
  buyerUserId: string
  buyerUsername: string
}): Promise<CreatePaymentOrderResult> {
  const config = resolveMercadoPagoConfig()
  const orderId = randomUUID()
  const amount = Math.round(config.licensePriceMxn * params.months * 100) / 100
  const title = `Renovación ${params.months} ${
    params.months === 1 ? "mes" : "meses"
  } FlujoTV — ${params.userName}`

  const returnBase = `${config.siteUrl}/clientes?orden=${orderId}&estado=`

  await pool.query(
    `INSERT INTO mp_orders
       (id, status, user_name, months, amount, currency, buyer_user_id, external_reference)
     VALUES ($1::uuid, 'pending', $2, $3, $4, 'MXN', $5, $1::text)`,
    [orderId, params.userName, params.months, amount, params.buyerUserId]
  )

  try {
    const response = await mercadoPagoRequest<{
      id?: unknown
      init_point?: unknown
    }>("/checkout/preferences", {
      method: "POST",
      body: {
        items: [
          {
            id: "licencia-flujotv",
            title,
            quantity: 1,
            unit_price: amount,
            currency_id: "MXN",
          },
        ],
        purpose: "wallet_purchase",
        external_reference: orderId,
        auto_return: "approved",
        back_urls: {
          success: `${returnBase}aprobado`,
          failure: `${returnBase}rechazado`,
          pending: `${returnBase}pendiente`,
        },
        notification_url: `${config.siteUrl}/api/mercadopago/webhook`,
        metadata: {
          order_id: orderId,
          user_name: params.userName,
          months: params.months,
          buyer: params.buyerUsername,
        },
      },
    })

    const preferenceId =
      typeof response.data.id === "string" ? response.data.id : ""
    const initPoint =
      typeof response.data.init_point === "string"
        ? response.data.init_point
        : ""

    if (preferenceId.length === 0 || initPoint.length === 0) {
      throw new MercadoPagoError(
        502,
        "invalid_preference",
        "Mercado Pago no devolvió un checkout válido.",
        { details: response.data }
      )
    }

    await pool.query(
      `UPDATE mp_orders SET preference_id = $2, updated_at = now()
        WHERE id = $1`,
      [orderId, preferenceId]
    )

    return {
      orderId,
      initPoint,
      amount,
      currency: "MXN",
    }
  } catch (error) {
    // Sin checkout no hay compra: la orden pendiente se elimina para no
    // dejar filas que nadie va a pagar.
    await pool.query("DELETE FROM mp_orders WHERE id = $1", [orderId])
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/*                Procesamiento de pagos (webhook y conciliación)              */
/* -------------------------------------------------------------------------- */

async function getMercadoPagoPayment(
  paymentId: string
): Promise<MpPaymentPayload | null> {
  const response = await mercadoPagoRequest<unknown>(
    `/v1/payments/${encodeURIComponent(paymentId)}`
  )
  return isRecord(response.data) ? (response.data as MpPaymentPayload) : null
}

async function searchPaymentsByExternalReference(
  orderId: string
): Promise<MpPaymentPayload | null> {
  const response = await mercadoPagoRequest<{ results?: unknown }>(
    `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(orderId)}`
  )
  const results = Array.isArray(response.data.results)
    ? response.data.results
    : []
  // Los resultados llegan del más nuevo al más viejo. Preferimos un pago
  // `approved` aunque no sea el más reciente: en Checkout Pro el comprador
  // puede reintentar dentro del checkout y cada intento es un pago nuevo con
  // la misma `external_reference`; si el último intento fue rechazado pero
  // uno previo se aprobó, ese aprobado es el que debe renovar la orden.
  let newest: MpPaymentPayload | null = null
  for (const row of results) {
    if (!isRecord(row)) continue
    const candidate = row as MpPaymentPayload
    if (newest === null) newest = candidate
    if (candidate.status === "approved") return candidate
  }
  return newest
}

export type PaymentOutcome =
  | "renewed"
  | "renewal_failed"
  | "rejected"
  | "cancelled"
  | "in_process"
  | "already_processed"
  | "ignored"

/**
 * Ejecuta la renovación de una orden con cobro confirmado. La clave de
 * idempotencia determinista `mp-<orderId>` hace que repetir la llamada
 * (reintento del webhook, conciliación, reintento admin) devuelva la misma
 * renovación en lugar de sumar meses dos veces, así que es seguro invocarla
 * también sobre órdenes `paid` varadas o `renewal_failed`.
 */
async function attemptOrderRenewal(
  order: MpOrderRow,
  paymentId: string | null,
  renewalTimeoutMs?: number
): Promise<PaymentOutcome> {
  try {
    if (!isRenewalMonths(order.months)) {
      throw new MercadoPagoError(
        500,
        "invalid_months",
        `La orden ${order.id} tiene meses fuera de rango (${order.months}).`
      )
    }
    await renewFlujoLicense({
      userName: order.user_name,
      months: order.months as RenewalMonths,
      idempotencyKey: `mp-${order.id}`,
      timeoutMs: renewalTimeoutMs,
    })
    await pool.query(
      `UPDATE mp_orders
          SET status = 'renewed', renewed_at = now(), error = NULL, updated_at = now()
        WHERE id = $1`,
      [order.id]
    )
    notifyOrderChange(order.id)
    log("mercadopago.payment", {
      order_id: order.id,
      payment_id: paymentId,
      user_name: order.user_name,
      months: order.months,
      outcome: "renewed",
    })
    return "renewed"
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Renovación fallida."
    await pool
      .query(
        `UPDATE mp_orders
            SET status = 'renewal_failed', error = $2, updated_at = now()
          WHERE id = $1`,
        [order.id, message.slice(0, 500)]
      )
      .then(() => notifyOrderChange(order.id))
      .catch((updateError: unknown) =>
        logError("update_renewal_failed", updateError)
      )
    log("mercadopago.payment", {
      order_id: order.id,
      payment_id: paymentId,
      user_name: order.user_name,
      outcome: "renewal_failed",
      reason: message.slice(0, 300),
    })
    return "renewal_failed"
  }
}

/**
 * Núcleo compartido por el webhook y la conciliación: verifica el pago contra
 * la API de Mercado Pago (nunca contra datos del navegador), reclama la orden
 * con una transición atómica hacia `paid` y renueva la licencia con la clave
 * de idempotencia determinista `mp-<orderId>` para que los reintentos de
 * Mercado Pago nunca dupliquen la renovación.
 */
export async function processPaymentNotification(params: {
  paymentId: string
}): Promise<PaymentOutcome> {
  const payment = await getMercadoPagoPayment(params.paymentId)
  if (!payment) {
    log("mercadopago.payment", {
      payment_id: params.paymentId,
      outcome: "ignored",
      reason: "payment_not_found",
    })
    return "ignored"
  }

  const externalReference =
    typeof payment.external_reference === "string"
      ? payment.external_reference
      : ""
  if (!UUID_RE.test(externalReference)) {
    log("mercadopago.payment", {
      payment_id: params.paymentId,
      outcome: "ignored",
      reason: "no_external_reference",
    })
    return "ignored"
  }

  const order = await getMpOrder(externalReference)
  if (!order) {
    log("mercadopago.payment", {
      payment_id: params.paymentId,
      external_reference: externalReference,
      outcome: "ignored",
      reason: "unknown_order",
    })
    return "ignored"
  }

  const paymentStatus =
    typeof payment.status === "string" ? payment.status : ""
  const paymentStatusDetail =
    typeof payment.status_detail === "string" ? payment.status_detail : ""

  if (paymentStatus !== "approved") {
    // Pago no aprobado (rechazado, cancelado o aún en proceso). Solo sella
    // una orden `pending`: nunca degrada una orden pagada, en renovación o
    // renovada por una notificación vieja de un intento rechazado.
    if (order.status !== "pending") {
      log("mercadopago.payment", {
        order_id: order.id,
        payment_id: params.paymentId,
        payment_status: paymentStatus,
        outcome: "already_processed",
      })
      return "already_processed"
    }
    if (paymentStatus === "rejected" || paymentStatus === "cancelled") {
      const next = paymentStatus === "rejected" ? "rejected" : "cancelled"
      void pool
        .query(
          `UPDATE mp_orders
              SET status = $2, payment_id = $3, payment_status = $4, updated_at = now()
            WHERE id = $1 AND status = 'pending'`,
          [order.id, next, params.paymentId, paymentStatus]
        )
        .then(() => notifyOrderChange(order.id))
        .catch((error: unknown) => logError("update_rejected_order", error))
      log("mercadopago.payment", {
        order_id: order.id,
        payment_id: params.paymentId,
        payment_status: paymentStatus,
        status_detail: paymentStatusDetail,
        outcome: next,
      })
      return next
    }
    void pool
      .query(
        `UPDATE mp_orders
            SET payment_id = $2, payment_status = $3, updated_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [order.id, params.paymentId, paymentStatus]
      )
      .catch((error: unknown) => logError("update_payment_status", error))
    log("mercadopago.payment", {
      order_id: order.id,
      payment_id: params.paymentId,
      payment_status: paymentStatus,
      status_detail: paymentStatusDetail,
      outcome: "in_process",
    })
    return "in_process"
  }

  // Verificación de importe y moneda contra la orden: un pago ajeno o con
  // otro monto no toca la orden y queda registrado para revisión.
  const paidAmount = Number(payment.transaction_amount)
  const paidCurrency =
    typeof payment.currency_id === "string" ? payment.currency_id : ""
  if (
    !Number.isFinite(paidAmount) ||
    Math.abs(paidAmount - order.amount) > 0.009 ||
    paidCurrency !== order.currency
  ) {
    log("mercadopago.payment", {
      order_id: order.id,
      payment_id: params.paymentId,
      outcome: "ignored",
      reason: "amount_mismatch",
      expected_amount: order.amount,
      paid_amount: payment.transaction_amount ?? null,
      paid_currency: paidCurrency,
    })
    return "ignored"
  }

  // Transición atómica hacia `paid`. El claim incluye `rejected` y
  // `cancelled` a propósito: en Checkout Pro el comprador puede reintentar un
  // pago rechazado y el reintento aprobado debe poder recuperar la orden.
  // Si otro webhook ya reclamó la orden, 0 filas.
  const claim = await pool.query(
    `UPDATE mp_orders
        SET status = 'paid', payment_id = $2, payment_status = $3, updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'rejected', 'cancelled')`,
    [order.id, params.paymentId, paymentStatus]
  )
  if (claim.rowCount === 0) {
    // ¿Orden ya renovada, varada en `paid` (un crash o deploy cortó el
    // proceso entre el cobro y la renovación) o `renewal_failed` que MP
    // está notificando de nuevo? En los tres casos reintentar la renovación
    // es seguro: la clave determinista evita duplicar meses.
    const current = await getMpOrder(order.id)
    if (
      current &&
      (current.status === "paid" || current.status === "renewal_failed")
    ) {
      return attemptOrderRenewal(current, params.paymentId)
    }
    log("mercadopago.payment", {
      order_id: order.id,
      payment_id: params.paymentId,
      outcome: "already_processed",
    })
    return "already_processed"
  }

  // Cobro confirmado: renovar.
  const claimed = (await getMpOrder(order.id)) ?? order
  return attemptOrderRenewal(claimed, params.paymentId)
}

/* -------------------------------------------------------------------------- */
/*                              Conciliación                                   */
/* -------------------------------------------------------------------------- */

/**
 * Red de seguridad en dos frentes, al consultar la orden:
 * - `pending` antigua: el webhook puede haberse perdido; se busca el pago por
 *   `external_reference` en la API de MP y se procesa como si hubiera llegado
 *   la notificación.
 * - `paid` varada: un crash o `pm2 reload` cortó el proceso entre el cobro y
 *   la renovación; el pago ya está verificado, así que se reintenta la
 *   renovación (seguro por la clave determinista) pasado un margen prudente
 *   para no pisa una renovación en curso.
 */
export async function reconcilePendingOrder(
  order: MpOrderRow
): Promise<MpOrderRow> {
  if (order.status === "pending") {
    if (Date.now() - Date.parse(order.created_at) >= RECONCILE_AFTER_MS) {
      try {
        const payment = await searchPaymentsByExternalReference(order.id)
        if (payment) {
          const paymentId =
            typeof payment.id === "number" ? String(payment.id) : ""
          if (paymentId.length > 0) {
            await processPaymentNotification({ paymentId })
          }
        }
      } catch (error) {
        logError(`reconcile_order_${order.id}`, error)
      }
    }
  } else if (
    order.status === "paid" &&
    Date.now() - Date.parse(order.updated_at) >= STUCK_PAID_AFTER_MS
  ) {
    try {
      await attemptOrderRenewal(
        order,
        order.payment_id === null ? null : String(order.payment_id)
      )
    } catch (error) {
      logError(`reconcile_stuck_paid_${order.id}`, error)
    }
  }
  const fresh = await getMpOrder(order.id)
  return fresh ?? order
}

/* -------------------------------------------------------------------------- */
/*                          Reintento admin de renovación                      */
/* -------------------------------------------------------------------------- */

/**
 * Reintenta la renovación de una orden `renewal_failed` o de una orden
 * `paid` varada (cobro ya hecho cuya renovación quedó cortada, p. ej. por un
 * deploy durante la llamada al panel). No vuelve a cobrar: re-ejecuta la
 * llamada al panel con la misma clave de idempotencia determinista.
 */
export async function retryOrderRenewal(orderId: string): Promise<MpOrderRow> {
  const order = await getMpOrder(orderId)
  if (!order) {
    throw new MercadoPagoError(404, "not_found", "La orden no existe.")
  }
  if (order.status !== "renewal_failed" && order.status !== "paid") {
    throw new MercadoPagoError(
      409,
      "invalid_order_status",
      `Solo se pueden reintentar órdenes con renovación fallida o varadas en pagado (estado actual: ${order.status}).`
    )
  }

  const outcome = await attemptOrderRenewal(
    order,
    order.payment_id === null ? null : String(order.payment_id)
  )

  log("mercadopago.order_retry", {
    order_id: order.id,
    user_name: order.user_name,
    outcome,
  })

  const fresh = await getMpOrder(order.id)
  return fresh ?? order
}

/* -------------------------------------------------------------------------- */
/*                       Órdenes por transferencia bancaria                    */
/* -------------------------------------------------------------------------- */

export interface CreatedTransferOrder {
  orderId: string
  amount: number
  currency: string
}

/**
 * Crea la orden `pending` de una transferencia bancaria: el comprobante ya
 * está guardado (`ticket_file_id`) y la renovación ocurre solo cuando el
 * admin aprueba la revisión (`approveTransferOrder`), nunca al subirlo.
 * El importe queda congelado en la orden, igual que en Mercado Pago.
 */
export async function createTransferOrder(params: {
  userName: string
  months: RenewalMonths
  buyerUserId: string
  ticketFileId: string
}): Promise<CreatedTransferOrder> {
  const orderId = randomUUID()
  const amount =
    Math.round(resolveMercadoPagoConfig().licensePriceMxn * params.months * 100) /
    100

  await pool.query(
    `INSERT INTO mp_orders
       (id, status, method, user_name, months, amount, currency, buyer_user_id,
        external_reference, ticket_file_id)
     VALUES ($1::uuid, 'pending', 'transferencia', $2, $3, $4, 'MXN', $5,
             $1::text, $6::uuid)`,
    [orderId, params.userName, params.months, amount, params.buyerUserId, params.ticketFileId]
  )

  notifyOrderChange(orderId)

  return { orderId, amount, currency: "MXN" }
}

export interface TransferOrderPublic {
  id: string
  status: MpOrderStatus
  user_name: string
  months: number
  amount: number
  currency: string
  buyer_username: string | null
  ticket:
    | { id: string; fileName: string; mimeType: string; sizeBytes: number }
    | null
  error: string | null
  created_at: string
}

interface TransferJoinRow extends Record<string, unknown> {
  buyer_username: string | null
  ticket_file_name: string | null
  ticket_mime_type: string | null
  ticket_size_bytes: number | null
}

function parseTransferRow(row: TransferJoinRow): TransferOrderPublic {
  const order = parseRow(row)
  const ticketId = order.ticket_file_id
  return {
    id: order.id,
    status: order.status,
    user_name: order.user_name,
    months: order.months,
    amount: order.amount,
    currency: order.currency,
    buyer_username:
      typeof row.buyer_username === "string" && row.buyer_username.length > 0
        ? row.buyer_username
        : null,
    ticket:
      ticketId &&
      typeof row.ticket_file_name === "string" &&
      typeof row.ticket_mime_type === "string"
        ? {
            id: ticketId,
            fileName: row.ticket_file_name,
            mimeType: row.ticket_mime_type,
            sizeBytes: Number(row.ticket_size_bytes ?? 0),
          }
        : null,
    error: order.error,
    created_at: order.created_at,
  }
}

/** Transferencias pendientes de revisión, las más nuevas primero (admin). */
export async function listPendingTransferOrders(): Promise<
  TransferOrderPublic[]
> {
  const result = await pool.query<TransferJoinRow>(
    `SELECT o.*, u.username AS buyer_username,
            f.file_name AS ticket_file_name, f.mime_type AS ticket_mime_type,
            f.size_bytes AS ticket_size_bytes
       FROM mp_orders o
       LEFT JOIN users u ON u.id = o.buyer_user_id
       LEFT JOIN user_files f ON f.id = o.ticket_file_id
      WHERE o.method = 'transferencia' AND o.status = 'pending'
      ORDER BY o.created_at DESC
      LIMIT 50`
  )
  return result.rows.map(parseTransferRow)
}

/**
 * Aprueba una transferencia pendiente: reclama la orden hacia `paid`
 * atómicamente y ejecuta la renovación con la clave determinista
 * `mp-<orderId>`. Con renovación fallida la orden queda `renewal_failed` y
 * el reintento admin existente la recupera sin volver a cobrar.
 */
export async function approveTransferOrder(orderId: string): Promise<MpOrderRow> {
  const order = await getMpOrder(orderId)
  if (!order) {
    throw new MercadoPagoError(404, "not_found", "La orden no existe.")
  }
  if (order.method !== "transferencia") {
    throw new MercadoPagoError(
      409,
      "invalid_order_method",
      "La orden no es una transferencia bancaria."
    )
  }
  if (order.status !== "pending") {
    throw new MercadoPagoError(
      409,
      "invalid_order_status",
      `Solo se pueden aprobar transferencias pendientes (estado actual: ${order.status}).`
    )
  }

  const claim = await pool.query(
    `UPDATE mp_orders SET status = 'paid', updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [order.id]
  )
  if (claim.rowCount === 0) {
    throw new MercadoPagoError(
      409,
      "order_already_processed",
      "La transferencia ya fue procesada por otra revisión."
    )
  }

  const claimed = (await getMpOrder(order.id)) ?? order
  const outcome = await attemptOrderRenewal(claimed, null)

  log("mercadopago.transfer_review", {
    order_id: order.id,
    user_name: order.user_name,
    decision: "approved",
    outcome,
  })

  const fresh = await getMpOrder(order.id)
  return fresh ?? claimed
}

/** Rechaza una transferencia pendiente (comprobante inválido, sin pago, etc.). */
export async function rejectTransferOrder(
  orderId: string,
  reason: string | null
): Promise<MpOrderRow> {
  const order = await getMpOrder(orderId)
  if (!order) {
    throw new MercadoPagoError(404, "not_found", "La orden no existe.")
  }
  if (order.method !== "transferencia") {
    throw new MercadoPagoError(
      409,
      "invalid_order_method",
      "La orden no es una transferencia bancaria."
    )
  }
  if (order.status !== "pending") {
    throw new MercadoPagoError(
      409,
      "invalid_order_status",
      `Solo se pueden rechazar transferencias pendientes (estado actual: ${order.status}).`
    )
  }

  const claim = await pool.query(
    `UPDATE mp_orders
        SET status = 'rejected', error = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [order.id, reason ? reason.slice(0, 500) : null]
  )
  if (claim.rowCount === 0) {
    throw new MercadoPagoError(
      409,
      "order_already_processed",
      "La transferencia ya fue procesada por otra revisión."
    )
  }

  notifyOrderChange(order.id)
  log("mercadopago.transfer_review", {
    order_id: order.id,
    user_name: order.user_name,
    decision: "rejected",
    reason: reason ? reason.slice(0, 300) : null,
  })

  const fresh = await getMpOrder(order.id)
  return fresh ?? order
}

/* -------------------------------------------------------------------------- */
/*                          Órdenes pagadas con cupón                          */
/* -------------------------------------------------------------------------- */

/**
 * Cupones activos. Por ahora solo existe el 0000: compra directa de QA sin
 * catálogo ni vigencia, conmutada con `COUPON_QA_ENABLED` (desactivada por
 * defecto: un código de prueba permanente sería una fuente ilimitada de
 * renovaciones gratis). Cuando exista un catálogo de cupones autorizados se
 * sustituye por la consulta correspondiente (código → descuento/vigencia).
 */
const ACTIVE_COUPON_CODES = new Set(["0000"])

export interface CreatedCouponOrder {
  orderId: string
  amount: number
  currency: string
  status: MpOrderStatus
}

/**
 * Renovación pagada con cupón: valida el código, crea la orden ya `paid`
 * (el cupón ES el pago) y ejecuta la renovación al instante con la clave
 * determinista `mp-<orderId>`. Sin checkout ni revisión: si la renovación
 * contra el panel falla la orden queda `renewal_failed` para el reintento,
 * igual que en los otros métodos.
 *
 * Idempotente por `requestId`: el cliente genera un id por intención de
 * canje y lo conserva entre reintentos (respuesta perdida, doble clic), así
 * que repetir la solicitud devuelve la orden original en lugar de sumar
 * otro mes. La renovación usa el presupuesto de compras (60 s), no el
 * timeout largo: la respuesta no debe colgar más de lo que Cloudflare
 * está dispuesto a esperar.
 */
export async function createCouponOrder(params: {
  userName: string
  months: RenewalMonths
  buyerUserId: string
  code: string
  requestId: string
}): Promise<CreatedCouponOrder> {
  if (!isCouponQaEnabled()) {
    throw new MercadoPagoError(
      503,
      "coupon_disabled",
      "El pago con cupón está desactivado en el servidor."
    )
  }

  const code = params.code.trim()
  if (!ACTIVE_COUPON_CODES.has(code)) {
    throw new MercadoPagoError(
      422,
      "invalid_coupon",
      "El código de cupón no es válido."
    )
  }

  // Tope de canjes por comprador en 24 h: un código de QA no debe permitir
  // renovaciones ilimitadas aunque esté activado.
  const redeemed = await pool.query(
    `SELECT count(*)::int AS n
       FROM mp_orders
      WHERE method = 'cupon'
        AND buyer_user_id = $1::uuid
        AND created_at >= now() - interval '24 hours'`,
    [params.buyerUserId]
  )
  const limit = couponQaDailyLimit()
  if ((redeemed.rows[0]?.n ?? 0) >= limit) {
    throw new MercadoPagoError(
      429,
      "coupon_limit",
      `Ya canjeaste el máximo de ${limit} cupones por día.`
    )
  }

  const amount =
    Math.round(resolveMercadoPagoConfig().licensePriceMxn * params.months * 100) /
    100

  // INSERT con claim por request_id: un reintento con el mismo id no crea
  // una segunda orden (índice único parcial), recupera la existente.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO mp_orders
       (id, status, method, user_name, months, amount, currency, buyer_user_id,
        external_reference, coupon_code, coupon_request_id)
     VALUES ($1::uuid, 'paid', 'cupon', $2, $3, $4, 'MXN', $5, $1::text, $6, $7)
     ON CONFLICT (coupon_request_id) WHERE method = 'cupon' AND coupon_request_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      params.userName,
      params.months,
      amount,
      params.buyerUserId,
      code,
      params.requestId,
    ]
  )

  let order: MpOrderRow | null
  if (inserted.rows.length > 0) {
    order = await getMpOrder(inserted.rows[0].id)
  } else {
    // Reintento con el mismo request_id: localiza la orden original del
    // mismo comprador (el índice es global; un id ajeno no filtra nada).
    const replayed = await pool.query<{ id: string }>(
      `SELECT id FROM mp_orders
        WHERE coupon_request_id = $1 AND buyer_user_id = $2::uuid`,
      [params.requestId, params.buyerUserId]
    )
    order = replayed.rows[0] ? await getMpOrder(replayed.rows[0].id) : null
    if (order) {
      log("mercadopago.coupon_replay", {
        order_id: order.id,
        user_name: params.userName,
        coupon: code,
        status: order.status,
      })
    }
  }

  if (!order) {
    throw new MercadoPagoError(
      500,
      "order_not_found",
      "La orden de cupón no pudo crearse."
    )
  }

  // Una orden reintento ya renovada no vuelve al panel: renovar de nuevo con
  // la misma clave determinista sería un no-op costoso.
  let outcome: PaymentOutcome
  if (order.status === "renewed") {
    outcome = "renewed"
  } else {
    outcome = await attemptOrderRenewal(order, null, FLUJO_PURCHASE_TIMEOUT_MS)
  }

  log("mercadopago.coupon_order", {
    order_id: order.id,
    user_name: params.userName,
    months: params.months,
    coupon: code,
    outcome,
  })

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    status: outcome === "renewal_failed" ? "renewal_failed" : "renewed",
  }
}

/* -------------------------------------------------------------------------- */
/*                          Consulta pública para la API                       */
/* -------------------------------------------------------------------------- */

export async function getMpOrderPublic(
  orderId: string
): Promise<MpOrderPublic | null> {
  const row = await getMpOrder(orderId)
  return row ? toMpOrderPublic(row) : null
}
