import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { MercadoPagoError } from "./errors"
import { mercadoPagoRequest } from "./client"
import {
  resolveMercadoPagoGateway,
  isCouponQaEnabled,
} from "./config"
import {
  couponDailyLimitForBuyer,
  couponMonthlyLimitForBuyer,
  retryOrderRenewal,
} from "./service"
import { mpTotalMxn } from "@/lib/mp-pricing"
import { parseAbonoAmount } from "@/lib/saldo"

/**
 * Órdenes de abono de saldo del módulo «Abonar saldo»
 * (`/modulos/abonar-saldo`): el mismo motor de pagos de las renovaciones
 * (`mp_orders`) con la marca `months = 0` — la diferencia es que el monto lo
 * define el comprador y el cumplimiento acredita saldo en su cuenta en vez
 * de renovar una licencia (el despacho por `months = 0` vive en
 * `attemptOrderRenewal`, compartido por webhook, conciliación, revisión
 * admin y reintento).
 *
 * Métodos, con el mismo tratamiento que las renovaciones:
 *
 * - **Mercado Pago**: el cargo se engrosa con `mpTotalMxn` (comisión 3.49% +
 *   $4 y su IVA) para que el depósito neto sea EXACTAMENTE el monto que el
 *   comprador definió; el webhook verifica contra el total engrosado y el
 *   crédito aplica después, verificado y con idempotencia por orden.
 * - **Transferencia**: orden `pending` con ticket y concepto de pago; el
 *   monto a acreditar es el transferido (sin comisión) y la revisión es la
 *   misma de las renovaciones (escaneo automático + admin).
 * - **Cupón QA (0000)**: solo con `COUPON_QA_ENABLED`, con los mismos topes
 *   de canjes por comprador; el canje ES el pago y la acreditación es
 *   sincrónica (es local: no depende del panel FlujoTV).
 */

/** Códigos QA válidos para abonos (mismo catálogo que las renovaciones). */
const SALDO_QA_COUPON_CODES = new Set(["0000"])

/** Ruta de retorno del checkout de Mercado Pago para abonos. */
export const SALDO_RETURN_PATH = "/modulos/abonar-saldo"

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

/* -------------------------------------------------------------------------- */
/*                       Orden de Mercado Pago (engrosada)                      */
/* -------------------------------------------------------------------------- */

export interface CreatedSaldoPaymentOrder {
  orderId: string
  initPoint: string
  /** Total engrosado que se cobra con Mercado Pago. */
  amount: number
  /** Monto que se acreditará al saldo cuando el pago se confirme. */
  creditAmount: number
  currency: string
}

/**
 * Crea la orden `pending` y la preferencia de Mercado Pago para un abono:
 * `purpose: wallet_purchase`, importe engrosado (`mpTotalMxn`) congelado en
 * la orden y retorno al módulo. El webhook verifica contra la orden y el
 * crédito aplica vía `attemptOrderRenewal` (despacho `months = 0`).
 */
export async function createSaldoPaymentOrder(params: {
  buyerUserId: string
  buyerUsername: string
  /** Monto definido por el comprador que se acreditará al saldo (MXN). */
  amountMxn: unknown
  returnPath?: string
}): Promise<CreatedSaldoPaymentOrder> {
  const parsed = parseAbonoAmount(params.amountMxn)
  if (!parsed.ok) {
    throw new MercadoPagoError(422, "validation_error", parsed.message)
  }
  const creditAmount = parsed.amount
  const config = resolveMercadoPagoGateway()
  const orderId = randomUUID()
  const amount = mpTotalMxn(creditAmount)
  const returnBase = `${config.siteUrl}${params.returnPath ?? SALDO_RETURN_PATH}?orden=${orderId}&estado=`

  await pool.query(
    `INSERT INTO mp_orders
       (id, status, user_name, months, bonus_months, amount, currency, buyer_user_id, external_reference)
     VALUES ($1::uuid, 'pending', $2, 0, 0, $3, 'MXN', $4::uuid, $1::text)`,
    [orderId, params.buyerUsername, amount, params.buyerUserId]
  )

  try {
    const response = await mercadoPagoRequest<{ id?: unknown; init_point?: unknown }>(
      "/checkout/preferences",
      {
        method: "POST",
        body: {
          items: [
            {
              id: "abono-saldo",
              title: `Abono de saldo — ${params.buyerUsername}`,
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
            buyer: params.buyerUsername,
            kind: "abono-saldo",
            credit_amount: creditAmount,
          },
        },
      }
    )

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
      `UPDATE mp_orders SET preference_id = $2, updated_at = now() WHERE id = $1::uuid`,
      [orderId, preferenceId]
    )

    return {
      orderId,
      initPoint,
      amount,
      creditAmount,
      currency: "MXN",
    }
  } catch (error) {
    // Sin checkout no hay abono: la orden pendiente se elimina para no
    // dejar filas que nadie va a pagar.
    await pool.query("DELETE FROM mp_orders WHERE id = $1::uuid", [orderId])
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/*                    Orden por transferencia (revisión admin)                 */
/* -------------------------------------------------------------------------- */

export interface CreatedSaldoTransferOrder {
  orderId: string
  /** Monto que se acreditará al aprobarse la transferencia. */
  amount: number
  currency: string
}

/**
 * Crea la orden `pending` de un abono por transferencia bancaria: el ticket
 * ya está guardado y el crédito ocurre solo cuando el admin aprueba la
 * revisión (o el escaneo automático del comprobante lo autoriza). El monto
 * a acreditar es el transferido: la transferencia no tiene comisión.
 */
export async function createSaldoTransferOrder(params: {
  buyerUserId: string
  buyerUsername: string
  amountMxn: unknown
  ticketFileId: string
  conceptId?: string
  conceptCode?: string
}): Promise<CreatedSaldoTransferOrder> {
  const parsed = parseAbonoAmount(params.amountMxn)
  if (!parsed.ok) {
    throw new MercadoPagoError(422, "validation_error", parsed.message)
  }
  const orderId = randomUUID()

  await pool.query(
    `INSERT INTO mp_orders
       (id, status, method, user_name, months, bonus_months, amount, currency, buyer_user_id,
        external_reference, ticket_file_id, concept_id, concept_code)
     VALUES ($1::uuid, 'pending', 'transferencia', $2, 0, 0, $3, 'MXN', $4::uuid,
             $1::text, $5::uuid, $6::uuid, $7)`,
    [
      orderId,
      params.buyerUsername,
      parsed.amount,
      params.buyerUserId,
      params.ticketFileId,
      params.conceptId ?? null,
      params.conceptCode ?? null,
    ]
  )

  publishRealtimeDetached({
    kind: "mp_order",
    entityId: orderId,
    userName: params.buyerUsername,
    status: "pending",
  })

  return { orderId, amount: parsed.amount, currency: "MXN" }
}

/* -------------------------------------------------------------------------- */
/*                       Orden pagada con cupón (QA)                           */
/* -------------------------------------------------------------------------- */

export interface CreatedSaldoCouponOrder {
  orderId: string
  /** `applied` = crédito confirmado; `renewal_failed` = reintento seguro. */
  status: string
  /** Monto que se acredita (definido por el comprador). */
  creditAmount: number
  currency: string
  /** Saldo de la cuenta tras la acreditación (null si falló). */
  saldo: number | null
  error: string | null
}

/**
 * Canjea el cupón QA para un abono: valida el código y los topes por
 * comprador (los mismos contadores que las renovaciones: el canje diario y
 * mensual cuenta para ambos), crea la orden ya pagada y acredita el saldo
 * al instante vía el mismo cumplimiento (`months = 0`). Idempotente por
 * `request_id`: reintentos con el mismo id devuelven la orden original.
 */
export async function createSaldoCouponOrder(params: {
  buyerUserId: string
  buyerUsername: string
  code: string
  requestId: string
  amountMxn: unknown
}): Promise<CreatedSaldoCouponOrder> {
  const parsed = parseAbonoAmount(params.amountMxn)
  if (!parsed.ok) {
    throw new MercadoPagoError(422, "validation_error", parsed.message)
  }
  const creditAmount = parsed.amount
  const code = params.code.trim()

  if (!isCouponQaEnabled()) {
    throw new MercadoPagoError(
      503,
      "coupon_disabled",
      "El pago con cupón está desactivado en el servidor."
    )
  }
  if (!SALDO_QA_COUPON_CODES.has(code)) {
    throw new MercadoPagoError(
      422,
      "invalid_coupon",
      "El código de cupón no es válido."
    )
  }

  // Topes de canjes por comprador, en la misma transacción con advisory
  // lock del comprador que las renovaciones: dos canjes concurrentes no
  // pasan ambos el conteo.
  const tx = await pool.connect()
  let insertedId: string | null = null
  try {
    await tx.query("BEGIN")
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      params.buyerUserId,
    ])

    const redeemed = await tx.query<{ daily: number; monthly: number }>(
      `SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS daily,
              count(*)::int AS monthly
         FROM mp_orders
        WHERE method = 'cupon'
          AND buyer_user_id = $1::uuid
          AND created_at >= now() - interval '30 days'`,
      [params.buyerUserId]
    )
    const dailyLimit = await couponDailyLimitForBuyer(params.buyerUserId)
    if ((redeemed.rows[0]?.daily ?? 0) >= dailyLimit) {
      throw new MercadoPagoError(
        429,
        "coupon_limit",
        `Ya canjeaste el máximo de ${dailyLimit} cupones por día.`
      )
    }
    const monthlyLimit = await couponMonthlyLimitForBuyer(params.buyerUserId)
    if ((redeemed.rows[0]?.monthly ?? 0) >= monthlyLimit) {
      throw new MercadoPagoError(
        429,
        "coupon_monthly_limit",
        `Ya canjeaste el máximo de ${monthlyLimit} cupones este mes.`
      )
    }

    // INSERT con claim por request_id: un reintento con el mismo id no crea
    // una segunda orden, recupera la existente.
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO mp_orders
         (id, status, method, user_name, months, bonus_months, amount, currency, buyer_user_id,
          external_reference, coupon_code, coupon_request_id)
       VALUES ($1::uuid, 'paid', 'cupon', $2, 0, 0, $3, 'MXN', $4::uuid, $1::text, $5, $6)
       ON CONFLICT (coupon_request_id) WHERE method = 'cupon' AND coupon_request_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        params.buyerUsername,
        creditAmount,
        params.buyerUserId,
        code,
        params.requestId,
      ]
    )
    insertedId = inserted.rows[0]?.id ?? null
    await tx.query("COMMIT")
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    tx.release()
  }

  let orderId = insertedId
  if (!orderId) {
    // Reintento con el mismo request_id: localiza la orden original del
    // mismo comprador (el índice es global; un id ajeno no filtra nada).
    const replayed = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM mp_orders
        WHERE coupon_request_id = $1 AND buyer_user_id = $2::uuid`,
      [params.requestId, params.buyerUserId]
    )
    orderId = replayed.rows[0]?.id ?? null
    if (orderId && replayed.rows[0]?.status === "applied") {
      // Canje ya aplicado: responder el éxito sin re-ejecutar el cumplimiento.
      const saldo = await pool.query<{ saldo: string }>(
        "SELECT saldo FROM users WHERE id = $1::uuid",
        [params.buyerUserId]
      )
      log("saldo.coupon_order", {
        order_id: orderId,
        user_name: params.buyerUsername,
        outcome: "already_applied",
      })
      return {
        orderId,
        status: "applied",
        creditAmount,
        currency: "MXN",
        saldo: Number(saldo.rows[0]?.saldo ?? 0),
        error: null,
      }
    }
  }

  if (!orderId) {
    throw new MercadoPagoError(
      500,
      "order_not_found",
      "La orden de abono no pudo crearse."
    )
  }

  // Cumplimiento sincrónico: la acreditación es local (sin panel FlujoTV),
  // cabe de sobra en el presupuesto de la petición. El mismo cumplimiento
  // atómico sella `applied` o `renewal_failed` (reintento seguro).
  const fulfilled = await retryOrderRenewal(orderId)
  const saldo = await pool.query<{ saldo: string }>(
    "SELECT saldo FROM users WHERE id = $1::uuid",
    [params.buyerUserId]
  )

  log("saldo.coupon_order", {
    order_id: orderId,
    user_name: params.buyerUsername,
    amount: creditAmount,
    outcome: fulfilled.status,
  })

  return {
    orderId,
    status: fulfilled.status,
    creditAmount,
    currency: "MXN",
    saldo: Number.isFinite(Number(saldo.rows[0]?.saldo))
      ? Number(saldo.rows[0]?.saldo)
      : null,
    // Sin el detalle técnico al comprador (errores de BD llegan en inglés):
    // la UI ya explica el reintento seguro y el motivo real queda en la
    // orden (`mp_orders.error`) para el administrador.
    error: null,
  }
}
