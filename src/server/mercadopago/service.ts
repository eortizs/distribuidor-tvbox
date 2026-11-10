import { randomUUID } from "node:crypto"

import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { createRenewalNotification } from "@/server/notifications/service"
import { readFlujoLicenseExpiration, renewFlujoLicense } from "@/server/flujotv/service"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { consumeTransferConceptByOrder } from "@/server/transferencias/concepto"
import { isRenewalMonths, type RenewalMonths } from "@/lib/flujotv"
import { PAQUETE_COUPON_CODE } from "@/lib/paquetes"
import { mpTotalMxn } from "@/lib/mp-pricing"

import {
  resolveMercadoPagoConfig,
  isCouponQaEnabled,
  couponQaDailyLimit,
  couponQaMonthlyLimit,
} from "./config"
import { mercadoPagoRequest, type MercadoPagoResponse } from "./client"
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
  | "refunding"
  | "refunded"

export type MpOrderMethod = "mercadopago" | "transferencia" | "cupon"

export interface MpOrderRow {
  id: string
  status: MpOrderStatus
  method: MpOrderMethod
  user_name: string
  months: number
  /** Meses gratis del paquete (0 en renovaciones individuales). */
  bonus_months: number
  amount: number
  currency: string
  buyer_user_id: string | null
  preference_id: string | null
  payment_id: number | null
  payment_status: string | null
   ticket_file_id: string | null
    coupon_code: string | null
    /** Concepto de pago ligado (transferencias de la era del concepto). */
    concept_id: string | null
    concept_code: string | null
    renewal_baseline_expires_at: string | null
    /** Vencimiento nuevo verificado en el panel al marcar `renewed`. */
    renewal_verified_expires_at: string | null
    error: string | null
   renewed_at: string | null
   refunded_at: string | null
   created_at: string
   updated_at: string
 }

export interface MpOrderPublic {
  id: string
  status: MpOrderStatus
  user_name: string
  months: number
  /** Meses gratis del paquete (0 en renovaciones individuales). */
  bonus_months: number
  amount: number
  currency: string
  payment_id: number | null
  payment_status: string | null
  error: string | null
  renewed_at: string | null
  /**
   * Vencimiento nuevo verificado en el panel FlujoTV al confirmar la
   * renovación (la lectura que demostró el cambio): null si la orden no está
   * `renewed` o se renovó antes de la verificación.
   */
  renewal_verified_expires_at: string | null
  refunded_at: string | null
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

/**
 * Verificación anti-falsos-positivos: el panel de licencias puede responder
 * éxito a la renovación sin aplicarla de verdad. Tras renovar se relee el
 * vencimiento y la orden solo se marca `renewed` si cambió respecto al
 * original. Lecturas por intento (el panel puede tardar en reflejar el
 * cambio) con pausa entre ellas.
 */
const RENEWAL_VERIFY_ATTEMPTS = 3
const RENEWAL_VERIFY_RETRY_DELAY_MS = 1_500
/**
 * Presupuesto por lectura de verificación. `/find_user` consulta el panel
 * real de FlujoTV (scrapeo en vivo) y tarda ~20 s por lectura en producción:
 * el timeout debe cubrir eso con margen, sin llegar al presupuesto de las
 * compras.
 */
const RENEWAL_VERIFY_READ_TIMEOUT_MS = 45_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
 * clientes de otro dispositivo. El evento viaja con el usuario renovado y el
 * estado nuevo para que esas pantallas refresquen SOLO la fila afectada
 * (lectura en vivo del panel) en vez de recargar todo el listado. Mejor
 * esfuerzo, nunca bloquea la respuesta.
 */
function notifyOrderChange(
  order: Pick<MpOrderRow, "id" | "user_name">,
  status: MpOrderStatus
): void {
  publishRealtimeDetached({
    kind: "mp_order",
    entityId: order.id,
    userName: order.user_name,
    status,
  })
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
    bonus_months: Number(row.bonus_months ?? 0),
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
    concept_id:
      row.concept_id === null || row.concept_id === undefined
        ? null
        : String(row.concept_id),
    concept_code:
      row.concept_code === null || row.concept_code === undefined
        ? null
        : String(row.concept_code),
    renewal_baseline_expires_at:
      row.renewal_baseline_expires_at === null ||
      row.renewal_baseline_expires_at === undefined
        ? null
        : String(row.renewal_baseline_expires_at),
    renewal_verified_expires_at:
      row.renewal_verified_expires_at === null ||
      row.renewal_verified_expires_at === undefined
        ? null
        : String(row.renewal_verified_expires_at),
    error: row.error === null ? null : String(row.error),
    renewed_at:
      row.renewed_at === null ? null : new Date(row.renewed_at as string).toISOString(),
    refunded_at:
      row.refunded_at === null || row.refunded_at === undefined
        ? null
        : new Date(row.refunded_at as string).toISOString(),
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
    bonus_months: row.bonus_months,
    amount: row.amount,
    currency: row.currency,
    payment_id: row.payment_id,
    payment_status: row.payment_status,
    error: row.error,
    renewed_at: row.renewed_at,
    renewal_verified_expires_at: row.renewal_verified_expires_at,
    refunded_at: row.refunded_at,
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
 *
 * `bonusMonths` > 0 marca un paquete del módulo «Paquetes FlujoTV»: paga sus
 * `months` y la renovación añadirá los meses gratis; el precio no cambia.
 * `returnPath` fija la ruta de los back_urls del checkout (default
 * `/clientes`, la del módulo de paquetes pasa la suya).
 *
 * El cargo se engrosa con `mpTotalMxn`: Mercado Pago retiene su comisión
 * (3.49% + $4) y el IVA de la comisión del precio final, así que cobrar el
 * precio neto depositaría menos. El importe queda congelado en la orden y
 * el webhook verifica contra él.
 */
export async function createPaymentOrder(params: {
  userName: string
  months: RenewalMonths
  buyerUserId: string
  buyerUsername: string
  bonusMonths?: number
  returnPath?: string
}): Promise<CreatePaymentOrderResult> {
  const config = resolveMercadoPagoConfig()
  const orderId = randomUUID()
  const bonusMonths = params.bonusMonths ?? 0
  const netAmount =
    Math.round(config.licensePriceMxn * params.months * 100) / 100
  const amount = mpTotalMxn(netAmount)
  const title =
    bonusMonths > 0
      ? `Paquete ${params.months} meses + ${bonusMonths} ${
          bonusMonths === 1 ? "mes gratis" : "meses gratis"
        } FlujoTV — ${params.userName}`
      : `Renovación ${params.months} ${
          params.months === 1 ? "mes" : "meses"
        } FlujoTV — ${params.userName}`

  const returnBase = `${config.siteUrl}${params.returnPath ?? "/clientes"}?orden=${orderId}&estado=`

  await pool.query(
    `INSERT INTO mp_orders
       (id, status, user_name, months, bonus_months, amount, currency, buyer_user_id, external_reference)
     VALUES ($1::uuid, 'pending', $2, $3, $4, $5, 'MXN', $6, $1::text)`,
    [orderId, params.userName, params.months, bonusMonths, amount, params.buyerUserId]
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
 * Vencimiento original de la licencia para verificar la renovación: se lee
 * del panel en el primer intento y se congela en la orden
 * (`renewal_baseline_expires_at`) para que los reintentos comparen contra el
 * original aunque un intento anterior ya hubiera movido el vencimiento (sin
 * esto, un reintento tras una renovación aplicada pero no verificada sería
 * imposible de confirmar).
 *
 * Sin línea base no hay forma de demostrar que el panel aplicó el cambio,
 * así que la renovación no se ejecuta: la orden queda `renewal_failed` y el
 * reintento (idempotente) la recupera.
 */
async function resolveRenewalBaseline(order: MpOrderRow): Promise<{
  raw: string
  ts: number
}> {
  if (order.renewal_baseline_expires_at !== null) {
    const storedTs = Date.parse(order.renewal_baseline_expires_at)
    if (!Number.isNaN(storedTs)) {
      return {
        raw: order.renewal_baseline_expires_at,
        ts: storedTs,
      }
    }
  }

  const read = await readFlujoLicenseExpiration(order.user_name, {
    timeoutMs: RENEWAL_VERIFY_READ_TIMEOUT_MS,
  })
  if (read.raw === null || read.ts === null) {
    throw new MercadoPagoError(
      503,
      "renewal_unverifiable",
      read.raw === null
        ? `No se pudo leer el vencimiento actual de '${order.user_name}' en el panel de licencias; sin esa lectura no se puede confirmar la renovación, así que no se ejecutó.`
        : `El panel de licencias reportó un vencimiento no interpretable ('${read.raw}'); la renovación no se ejecutó.`
    )
  }

  await pool
    .query(
      `UPDATE mp_orders
          SET renewal_baseline_expires_at = $2, updated_at = now()
        WHERE id = $1 AND renewal_baseline_expires_at IS NULL`,
      [order.id, read.raw]
    )
    .catch((error: unknown) => logError("store_renewal_baseline", error))

  return { raw: read.raw, ts: read.ts }
}

/**
 * Comprueba que el panel aplicó la renovación: relee el vencimiento y exige
 * uno distinto (posterior) al original. Hasta `RENEWAL_VERIFY_ATTEMPTS`
 * lecturas con pausa entre ellas porque el panel puede tardar en reflejar el
 * cambio; una lectura que no llega cuenta como intento y se reintenta.
 *
 * Con éxito devuelve el vencimiento nuevo que leyó del panel: es la fecha
 * verificada que se persiste en la orden y muestran los mensajes de éxito.
 */
async function verifyRenewalApplied(
  userName: string,
  baselineTs: number
): Promise<
  | { ok: true; verifiedAt: string }
  | { ok: false; lastRaw: string | null }
> {
  let lastRaw: string | null = null
  for (let attempt = 1; attempt <= RENEWAL_VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await delay(RENEWAL_VERIFY_RETRY_DELAY_MS)
    try {
      const read = await readFlujoLicenseExpiration(userName, {
        timeoutMs: RENEWAL_VERIFY_READ_TIMEOUT_MS,
      })
      if (read.ts !== null && read.ts > baselineTs) {
        return { ok: true, verifiedAt: read.raw as string }
      }
      if (read.raw !== null) lastRaw = read.raw
    } catch {
      // Lectura fallida: se reintenta con la siguiente; si agota, el error
      // final reporta la última lectura conocida.
    }
  }
  return { ok: false, lastRaw }
}

/**
 * Ejecuta la renovación de una orden con cobro confirmado. La clave de
 * idempotencia determinista `mp-<orderId>` hace que repetir la llamada
 * (reintento del webhook, conciliación, reintento admin) devuelva la misma
 * renovación en lugar de sumar meses dos veces, así que es seguro invocarla
 * también sobre órdenes `paid` varadas o `renewal_failed`.
 *
 * Las órdenes de paquete añaden los meses gratis como renovaciones extra de
 * 1 mes con claves derivadas (`mp-<orderId>-b1`, `-b2`, …): cada paso es
 * idempotente por separado, así que una respuesta perdida a mitad del plan
 * se recobra re-ejecutándolo — los pasos ya aplicados devuelven su renovación
 * original y solo los pendientes se ejecutan de verdad.
 *
 * Éxito verificado, no declarado: antes de renovar se congela el vencimiento
 * original de la licencia como línea base y, tras el OK del panel, se relee
 * el vencimiento hasta verlo cambiar. Un panel que responde 200 sin aplicar
 * la renovación deja la orden en `renewal_failed` en lugar de un falso
 * «renovación exitosa».
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
    const bonusMonths =
      Number.isInteger(order.bonus_months) && order.bonus_months > 0
        ? order.bonus_months
        : 0
    const renewalSteps: { months: RenewalMonths; idempotencyKey: string }[] = [
      { months: order.months as RenewalMonths, idempotencyKey: `mp-${order.id}` },
      ...Array.from({ length: bonusMonths }, (_, index) => ({
        months: 1 as RenewalMonths,
        idempotencyKey: `mp-${order.id}-b${index + 1}`,
      })),
    ]
    const baseline = await resolveRenewalBaseline(order)
    for (const step of renewalSteps) {
      await renewFlujoLicense({
        userName: order.user_name,
        months: step.months,
        idempotencyKey: step.idempotencyKey,
        timeoutMs: renewalTimeoutMs,
      })
    }
    // Comprobación: releer el vencimiento y exigir que sea distinto al
    // original. Sin esto, un 200 del panel sin renovación real se reportaba
    // como éxito (falso positivo).
    const verification = await verifyRenewalApplied(
      order.user_name,
      baseline.ts
    )
    if (!verification.ok) {
      throw new MercadoPagoError(
        502,
        "renewal_not_applied",
        `El panel de licencias respondió éxito pero el vencimiento de '${order.user_name}' no cambió (original ${baseline.raw}; última lectura ${verification.lastRaw ?? "sin fecha"}). La renovación no se dio por aplicada: reintenta, la clave de idempotencia evita meses extra.`
      )
    }
    // El guard de estado evita pisar un reembolso reclamado en paralelo:
    // si otro flujo movió la orden a `refunding`/`refunded`, el resultado de
    // la renovación no se escribe (el reembolso ya es dueño de la orden).
    // La fecha verificada queda en la orden: los mensajes de éxito la
    // muestran como evidencia de que el panel realmente movió el vencimiento.
    const renewalClaim = await pool.query(
      `UPDATE mp_orders
          SET status = 'renewed', renewed_at = now(),
              renewal_verified_expires_at = $2,
              error = NULL, updated_at = now()
        WHERE id = $1 AND status IN ('paid', 'renewal_failed')`,
      [order.id, verification.verifiedAt]
    )
    if (renewalClaim.rowCount === 0) {
      log("mercadopago.payment", {
        order_id: order.id,
        payment_id: paymentId,
        outcome: "ignored",
        reason: "order_claimed_by_refund",
      })
      return "ignored"
    }
    notifyOrderChange(order, "renewed")
    // Aviso persistente al comprador: la campana de la cabecera muestra el
    // resultado con el usuario renovado y el vencimiento nuevo verificado.
    createRenewalNotification({
      buyerUserId: order.buyer_user_id,
      kind: "renewal_success",
      userName: order.user_name,
      months: order.months,
      bonusMonths: bonusMonths,
      verifiedExpiresAt: verification.verifiedAt,
      orderId: order.id,
    })
    log("mercadopago.payment", {
      order_id: order.id,
      payment_id: paymentId,
      user_name: order.user_name,
      months: order.months,
      bonus_months: bonusMonths,
      outcome: "renewed",
      verified_expires_at: verification.verifiedAt,
    })
    return "renewed"
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Renovación fallida."

    // Mercado Pago reenvía sus notificaciones (entrega at-least-once): un
    // segundo intento puede golpear al panel mientras el primero sigue en
    // curso, y el panel responde «Idempotency-Key está en curso. No se
    // ejecuta una segunda compra.» Eso NO es un fallo de renovación: el
    // intento original sigue vivo y sellará el resultado. Degradar la orden
    // a `renewal_failed` aquí mostraría al comprador un falso «la renovación
    // falló» y quedaría corregido segundos después por el intento en curso.
    // Se deja el estado tal cual (normalmente `paid`): si el intento en
    // curso falla de verdad, él mismo marcará `renewal_failed`; si muere sin
    // respuesta, la conciliación de `paid` varado reintenta a los 10 minutos.
    if (/está en curso/i.test(message)) {
      log("mercadopago.payment", {
        order_id: order.id,
        payment_id: paymentId,
        outcome: "in_progress",
        reason: message.slice(0, 300),
      })
      return "in_process"
    }

    const failedClaim = await pool
      .query(
        `UPDATE mp_orders
            SET status = 'renewal_failed', error = $2, updated_at = now()
          WHERE id = $1 AND status IN ('paid', 'renewal_failed')`,
        [order.id, message.slice(0, 500)]
      )
      .then((result) => result)
      .catch((updateError: unknown) => {
        logError("update_renewal_failed", updateError)
        return null
      })
    if (failedClaim !== null && failedClaim.rowCount !== null) {
      notifyOrderChange(order, "renewal_failed")
      // Aviso persistente solo en el PRIMER fallo (la orden venía de `paid`):
      // los reintentos que re-fallan sobre `renewal_failed` (conciliación,
      // reintento admin o de la UI) no duplican la notificación.
      if (failedClaim.rowCount > 0 && order.status === "paid") {
        createRenewalNotification({
          buyerUserId: order.buyer_user_id,
          kind: "renewal_failed",
          userName: order.user_name,
          months: order.months,
          error: message,
          orderId: order.id,
        })
      }
    }
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
        .then(() => notifyOrderChange(order, next))
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
 * La orden queda ligada al concepto de pago validado en la puerta
 * (`concept_id`/`concept_code`), que el escaneo del comprobante exige y que
 * se anula cuando la orden termina. El importe queda congelado en la orden,
 * igual que en Mercado Pago. `bonusMonths` > 0 marca un paquete del módulo
 * «Paquetes FlujoTV».
 */
export async function createTransferOrder(params: {
  userName: string
  months: RenewalMonths
  buyerUserId: string
  ticketFileId: string
  bonusMonths?: number
  conceptId?: string
  conceptCode?: string
}): Promise<CreatedTransferOrder> {
  const orderId = randomUUID()
  const bonusMonths = params.bonusMonths ?? 0
  const amount =
    Math.round(resolveMercadoPagoConfig().licensePriceMxn * params.months * 100) /
    100

  await pool.query(
    `INSERT INTO mp_orders
       (id, status, method, user_name, months, bonus_months, amount, currency, buyer_user_id,
        external_reference, ticket_file_id, concept_id, concept_code)
     VALUES ($1::uuid, 'pending', 'transferencia', $2, $3, $4, $5, 'MXN', $6,
             $1::text, $7::uuid, $8::uuid, $9)`,
    [
      orderId,
      params.userName,
      params.months,
      bonusMonths,
      amount,
      params.buyerUserId,
      params.ticketFileId,
      params.conceptId ?? null,
      params.conceptCode ?? null,
    ]
  )

  notifyOrderChange({ id: orderId, user_name: params.userName }, "pending")

  return { orderId, amount, currency: "MXN" }
}

export interface TransferScanSummary {
  /** approved | rejected | error (resultado del escaneo LLM del ticket). */
  status: string
  /** Motivos legibles del rechazo automático (vacío si approved/error). */
  reasons: string[]
  model: string | null
  at: string | null
}

export interface TransferOrderPublic {
  id: string
  status: MpOrderStatus
  user_name: string
  months: number
  /** Meses gratis del paquete (0 en renovaciones individuales). */
  bonus_months: number
  amount: number
  currency: string
  buyer_username: string | null
  /** Concepto de pago de 4 caracteres (null en órdenes previas al concepto). */
  concept_code: string | null
  ticket:
    | { id: string; fileName: string; mimeType: string; sizeBytes: number }
    | null
  /** Resultado del escaneo automático del comprobante (null si no hubo). */
  scan: TransferScanSummary | null
  error: string | null
  created_at: string
}

interface TransferJoinRow extends Record<string, unknown> {
  buyer_username: string | null
  ticket_file_name: string | null
  ticket_mime_type: string | null
  ticket_size_bytes: number | null
}

function parseScanSummary(row: TransferJoinRow): TransferScanSummary | null {
  const status = row.scan_status
  if (typeof status !== "string" || status.length === 0) return null
  let reasons: string[] = []
  if (isRecord(row.scan_result) && Array.isArray(row.scan_result.reasons)) {
    reasons = row.scan_result.reasons
      .filter((item): item is string => typeof item === "string")
      .slice(0, 6)
  }
  return {
    status,
    reasons,
    model: typeof row.scan_model === "string" ? row.scan_model : null,
    at:
      row.scan_at === null || row.scan_at === undefined
        ? null
        : new Date(row.scan_at as string).toISOString(),
  }
}

function parseTransferRow(row: TransferJoinRow): TransferOrderPublic {
  const order = parseRow(row)
  const ticketId = order.ticket_file_id
  return {
    id: order.id,
    status: order.status,
    user_name: order.user_name,
    months: order.months,
    bonus_months: order.bonus_months,
    amount: order.amount,
    currency: order.currency,
    buyer_username:
      typeof row.buyer_username === "string" && row.buyer_username.length > 0
        ? row.buyer_username
        : null,
    concept_code: order.concept_code,
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
    scan: parseScanSummary(row),
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

  // Transferencia exitosa: el concepto de pago queda anulado (consumed) y la
  // siguiente transacción del comprador recibe un código nuevo.
  await consumeTransferConceptByOrder(order.id).catch((error: unknown) =>
    logError(`transfer_concept_consume ${order.id}`, error)
  )

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

  // Transferencia fallida: el concepto de pago queda anulado (consumed) y la
  // siguiente transacción del comprador recibe un código nuevo.
  await consumeTransferConceptByOrder(order.id).catch((error: unknown) =>
    logError(`transfer_concept_consume ${order.id}`, error)
  )

  notifyOrderChange(order, "rejected")
  // Aviso persistente al comprador: su renovación por transferencia no
  // ocurrió y necesita saberlo sin estar mirando la pantalla.
  createRenewalNotification({
    buyerUserId: order.buyer_user_id,
    kind: "transfer_rejected",
    userName: order.user_name,
    months: order.months,
    error: reason,
    orderId: order.id,
  })
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

/**
 * Cupón asignado a los paquetes del módulo «Paquetes FlujoTV»: la forma de
 * pago «Cupón» de ese módulo lo usa para cualquiera de los paquetes (3, 6 o
 * 12 meses). No depende de `COUPON_QA_ENABLED` — el módulo lo ofrece siempre
 * — pero comparte los topes de canjes por comprador del resto de cupones.
 * El código vive en `@/lib/paquetes` (isomórfico) para que la UI muestre
 * exactamente el código que el servidor valida.
 */
const PACKAGE_COUPON_CODE = PAQUETE_COUPON_CODE

export interface CreatedCouponOrder {
  orderId: string
  amount: number
  currency: string
  /**
   * `renewed` = renovación confirmada; `renewal_failed` = canje registrado
   * pero renovación no confirmada (reintento seguro); `pending` = canje
   * registrado y renovación EN CURSO en el servidor (solo paquetes: el
   * cliente debe sondear el estado de la orden en lugar de esperar la
   * respuesta HTTP).
   */
  status: MpOrderStatus
  /** Razón del fallo de renovación tal como quedó en la orden; null si éxitó. */
  error: string | null
  /**
   * Vencimiento nuevo verificado en el panel (solo con `renewed`): la
   * confirmación lo muestra para que el comprador vea la fecha real.
   */
  verifiedExpiresAt: string | null
  /** Meses pagados de la orden (para etiquetas fieles en el cliente). */
  months: number
  /** Meses gratis de la orden (para etiquetas fieles en el cliente). */
  bonusMonths: number
}

/**
 * Tope diario de canjes de cupón efectivo para un comprador: el override por
 * usuario (`users.coupon_daily_limit`, lo ajusta el admin desde /users) si
 * existe; si no, el valor global del servidor (`COUPON_QA_DAILY_LIMIT`).
 */
export async function couponDailyLimitForBuyer(
  buyerUserId: string
): Promise<number> {
  const result = await pool.query<{ coupon_daily_limit: number | null }>(
    "SELECT coupon_daily_limit FROM users WHERE id = $1::uuid",
    [buyerUserId]
  )
  const override = result.rows[0]?.coupon_daily_limit
  return typeof override === "number" && Number.isInteger(override) && override > 0
    ? override
    : couponQaDailyLimit()
}

/**
 * Tope mensual (acumulado, ventana rodante de 30 días) efectivo para un
 * comprador: el override por usuario (`users.coupon_monthly_limit`) si
 * existe; si no, el valor global del servidor (`COUPON_QA_MONTHLY_LIMIT`).
 */
export async function couponMonthlyLimitForBuyer(
  buyerUserId: string
): Promise<number> {
  const result = await pool.query<{ coupon_monthly_limit: number | null }>(
    "SELECT coupon_monthly_limit FROM users WHERE id = $1::uuid",
    [buyerUserId]
  )
  const override = result.rows[0]?.coupon_monthly_limit
  return typeof override === "number" && Number.isInteger(override) && override > 0
    ? override
    : couponQaMonthlyLimit()
}

/**
 * Renovación pagada con cupón: valida el código, crea la orden ya `paid`
 * (el cupón ES el pago) y ejecuta la renovación con la clave determinista
 * `mp-<orderId>`. Sin checkout ni revisión: si la renovación contra el panel
 * falla la orden queda `renewal_failed` para el reintento, igual que en los
 * otros métodos.
 *
 * Idempotente por `requestId`: el cliente genera un id por intención de
 * canje y lo conserva entre reintentos (respuesta perdida, doble clic), así
 * que repetir la solicitud devuelve la orden original en lugar de sumar
 * otro mes.
 *
 * Canjes individuales (0000, 1 mes): renovación SINCRÓNICA con el presupuesto
 * de compras (60 s) — cabe en la paciencia de Cloudflare y su UI depende de
 * la respuesta. Canjes de paquete (bonusMonths > 0): el plan completo no
 * cabe, así que la renovación se dispara desacoplada y la respuesta devuelve
 * `pending` para que el cliente sondee la orden; el resultado se sella igual
 * (verified / renewal_failed) en la orden.
 */
export async function createCouponOrder(params: {
  userName: string
  months: RenewalMonths
  buyerUserId: string
  code: string
  requestId: string
  /** Meses gratis del paquete (> 0 marca un canje del módulo de paquetes). */
  bonusMonths?: number
}): Promise<CreatedCouponOrder> {
  const bonusMonths = params.bonusMonths ?? 0
  const code = params.code.trim()
  if (bonusMonths > 0) {
    // Canje de paquete: el cupón asignado es 1010 y el módulo lo ofrece
    // siempre; el cliente no elige código, el servidor lo valida aquí.
    if (code !== PACKAGE_COUPON_CODE) {
      throw new MercadoPagoError(
        422,
        "invalid_coupon",
        "El código de cupón no es válido para paquetes."
      )
    }
  } else {
    if (!isCouponQaEnabled()) {
      throw new MercadoPagoError(
        503,
        "coupon_disabled",
        "El pago con cupón está desactivado en el servidor."
      )
    }

    if (!ACTIVE_COUPON_CODES.has(code)) {
      throw new MercadoPagoError(
        422,
        "invalid_coupon",
        "El código de cupón no es válido."
      )
    }
  }

  // Topes de canjes por comprador: diario (ventana de 24 h) y mensual
  // acumulado (ventana rodante de 30 días). Un código de QA no debe permitir
  // renovaciones ilimitadas aunque esté activado, y repartir canjes en días
  // distintos no debe sortear el techo del mes. Cada tope es por usuario
  // (override del admin desde /users) con fallback al global del servidor.
  //
  // El conteo y el INSERT van en UNA transacción con advisory lock del
  // comprador: sin ella, dos solicitudes concurrentes con distinto
  // request_id pasan ambas el conteo y crean dos órdenes pagadas (cada canje
  // de paquete regala 7-14 meses, así que la carrera cuesta meses, no pesos).
  const amount =
    Math.round(resolveMercadoPagoConfig().licensePriceMxn * params.months * 100) /
    100

  const tx = await pool.connect()
  let insertedId: string | null = null
  try {
    await tx.query("BEGIN")
    // Llave de 32 bits derivada del uuid del comprador; solo serializa el
    // canje de cupones de un mismo comprador.
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
    // una segunda orden (índice único parcial), recupera la existente.
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO mp_orders
         (id, status, method, user_name, months, bonus_months, amount, currency, buyer_user_id,
          external_reference, coupon_code, coupon_request_id)
       VALUES ($1::uuid, 'paid', 'cupon', $2, $3, $4, $5, 'MXN', $6, $1::text, $7, $8)
       ON CONFLICT (coupon_request_id) WHERE method = 'cupon' AND coupon_request_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        params.userName,
        params.months,
        bonusMonths,
        amount,
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

  let order: MpOrderRow | null
  if (insertedId) {
    order = await getMpOrder(insertedId)
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

  // Renovación de paquetes DESACOPLADA de la respuesta: el plan de un paquete
  // (línea base + hasta 3 renovaciones + verificación) excede de largo el
  // presupuesto ~100 s de Cloudflare cuando el panel está lento, así que
  // sostener la respuesta haría perderla SIEMPRE en el caso típico. La orden
  // queda `paid` y el cliente sondea `GET /api/mercadopago/orders/{id}`; la
  // conciliación de `paid` varado (10 min) y el reintento cubren un proceso
  // cortado a mitad del plan. Los canjes individuales (0000, 1 mes) siguen
  // sincrónicos: caben en el presupuesto y su UI depende de la respuesta.
  if (bonusMonths > 0 && order.status !== "renewed") {
    if (order.status === "paid" || order.status === "renewal_failed") {
      const target = order
      void attemptOrderRenewal(target, null, FLUJO_PURCHASE_TIMEOUT_MS)
        .then((outcome) => {
          log("mercadopago.coupon_order", {
            order_id: target.id,
            user_name: target.user_name,
            months: target.months,
            bonus_months: bonusMonths,
            coupon: code,
            outcome,
            via: "detached",
          })
        })
        .catch((error: unknown) => logError("coupon_detached_renewal", error))
    }
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      // Dentro de esta rama la orden NO está renovada (guard de arriba): el
      // cliente sondea hasta el resultado final.
      status: "pending",
      error: order.status === "renewal_failed" ? order.error : null,
      verifiedExpiresAt: null,
      months: order.months,
      bonusMonths: order.bonus_months,
    }
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
    bonus_months: bonusMonths,
    coupon: code,
    outcome,
  })

  // Orden fresca tras el intento: lleva el `error` guardado cuando falló y
  // el vencimiento verificado (`renewal_verified_expires_at`) cuando se
  // confirmó — la confirmación al comprador muestra esa fecha como evidencia.
  const fresh = await getMpOrder(order.id)

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    // Solo `renewed` se informa como éxito: `in_process` (Idempotency-Key en
    // curso en el panel) o cualquier otro resultado no confirmado se informa
    // como `renewal_failed` — la UI de cupón ofrece el reintento, que es
    // seguro con la clave determinista; la orden queda `paid` en BD y el
    // reintento la recupera.
    status: outcome === "renewed" ? "renewed" : "renewal_failed",
    error: fresh?.error ?? null,
    verifiedExpiresAt:
      outcome === "renewed" ? fresh?.renewal_verified_expires_at ?? null : null,
    months: order.months,
    bonusMonths: order.bonus_months,
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Reembolsos                                  */
/* -------------------------------------------------------------------------- */

/**
 * Una orden `refunding` estancada (un crash o deploy cortó el proceso entre
 * el reclamo y la respuesta de MP) se concilia contra la API de MP al
 * pedirse el listado, igual que las `pending` viejas.
 */
const REFUND_RECONCILE_AFTER_MS = 90_000

export interface RefundOrderView {
  id: string
  status: MpOrderStatus
  user_name: string
  months: number
  /** Meses gratis del paquete (0 en renovaciones individuales). */
  bonus_months: number
  amount: number
  currency: string
  payment_id: number | null
  buyer_username: string | null
  error: string | null
  refunded_at: string | null
  created_at: string
  updated_at: string
}

interface RefundJoinRow extends Record<string, unknown> {
  buyer_username: string | null
}

function parseRefundRow(row: RefundJoinRow): RefundOrderView {
  const order = parseRow(row)
  return {
    id: order.id,
    status: order.status,
    user_name: order.user_name,
    months: order.months,
    bonus_months: order.bonus_months,
    amount: order.amount,
    currency: order.currency,
    payment_id: order.payment_id,
    buyer_username:
      typeof row.buyer_username === "string" && row.buyer_username.length > 0
        ? row.buyer_username
        : null,
    error: order.error,
    refunded_at: order.refunded_at,
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

interface MpRefundPayload {
  id?: unknown
  payment_id?: unknown
  amount?: unknown
  status?: unknown
}

/**
 * Lista de reembolsos de un pago (`GET /v1/payments/{id}/refunds`). La API
 * ha devuelto un array directo o un objeto con `refunds`; se aceptan ambos.
 */
function parseRefundList(data: unknown): MpRefundPayload[] {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.refunds)
      ? data.refunds
      : []
  return list.filter(isRecord) as MpRefundPayload[]
}

function refundedTotalFrom(refunds: MpRefundPayload[]): number {
  return refunds.reduce((sum, refund) => {
    const amount = Number(refund.amount)
    const status = typeof refund.status === "string" ? refund.status : ""
    if (!Number.isFinite(amount) || status === "rejected") return sum
    return sum + amount
  }, 0)
}

/**
 * Extrae el reembolso relevante de una respuesta de MP: el reembolso directo,
 * un array de reembolsos o el pago con su lista `refunds` (en los dos últimos
 * casos importa el último, el que acabamos de crear). Un objeto que envuelve
 * una lista —p. ej. un pago con `refunds` vacía— no es un reembolso.
 */
function lastRefundFrom(data: unknown): MpRefundPayload | null {
  const list = parseRefundList(data)
  if (list.length > 0) return list[list.length - 1]
  if (isRecord(data) && !Array.isArray(data.refunds)) {
    return data as MpRefundPayload
  }
  return null
}

async function fetchPaymentRefunds(paymentId: number): Promise<MpRefundPayload[]> {
  // payment_id es bigint: en la URL viaja como entero sin decimales.
  const response = await mercadoPagoRequest<unknown>(
    `/v1/payments/${paymentId.toString()}/refunds`
  )
  return parseRefundList(response.data)
}

/**
 * Resuelve una orden varada en `refunding` consultando los reembolsos reales
 * del pago en MP: con devolución registrada por el total → `refunded` (con
 * fila de auditoría, idempotente por `mp_refund_id`); sin ningún reembolso
 * vigente (ninguno registrado o todos rechazados) → `renewal_failed` para que
 * el admin reintente. Reembolsos parciales no deberían existir con el flujo
 * de reembolso total, así que ese caso queda en `refunding` para la próxima
 * conciliación.
 */
async function settleStuckRefundingOrder(order: MpOrderRow): Promise<void> {
  if (order.payment_id === null) {
    // No debería ocurrir: solo órdenes con pago de MP entran a `refunding`.
    await pool.query(
      `UPDATE mp_orders
          SET status = 'renewal_failed',
              error = 'Reembolso interrumpido: la orden no tiene pago asociado',
              updated_at = now()
        WHERE id = $1 AND status = 'refunding'`,
      [order.id]
    )
    notifyOrderChange(order, "renewal_failed")
    return
  }

  const refunds = await fetchPaymentRefunds(order.payment_id)
  const refundedTotal = refundedTotalFrom(refunds)
  if (refundedTotal >= order.amount - 0.009) {
    // MP ejecutó el reembolso aunque la respuesta original se perdiera.
    const refund = refunds[refunds.length - 1]
    const refundId = typeof refund.id === "number" ? refund.id : null
    const refundStatus =
      typeof refund.status === "string" ? refund.status : "pending"
    await pool.query(
      `INSERT INTO mp_refunds
         (id, order_id, payment_id, amount, currency, mp_refund_id, status, reason)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'Conciliación automática del reembolso')
       ON CONFLICT (mp_refund_id) DO NOTHING`,
      [
        randomUUID(),
        order.id,
        order.payment_id,
        order.amount,
        order.currency,
        refundId,
        refundStatus,
      ]
    )
    await pool.query(
      `UPDATE mp_orders
          SET status = 'refunded', refunded_at = now(), error = NULL, updated_at = now()
        WHERE id = $1 AND status = 'refunding'`,
      [order.id]
    )
    notifyOrderChange(order, "refunded")
    log("mercadopago.refund", {
      order_id: order.id,
      payment_id: order.payment_id,
      outcome: "refunded",
      via: "reconcile",
    })
    return
  }

  if (refundedTotal <= 0.009) {
    // MP no devolvió dinero: ningún reembolso registrado o todos rechazados.
    // Volver a `renewal_failed` para que el admin reintente el reembolso.
    await pool.query(
      `UPDATE mp_orders
          SET status = 'renewal_failed',
              error = 'Reembolso interrumpido: Mercado Pago no registró la devolución',
              updated_at = now()
        WHERE id = $1 AND status = 'refunding'`,
      [order.id]
    )
    notifyOrderChange(order, "renewal_failed")
    log("mercadopago.refund", {
      order_id: order.id,
      payment_id: order.payment_id,
      outcome: "rolled_back",
      via: "reconcile",
    })
    return
  }

  log("mercadopago.refund", {
    order_id: order.id,
    payment_id: order.payment_id,
    outcome: "still_refunding",
    via: "reconcile",
  })
}

/**
 * Listado de la sección admin de reembolsos: órdenes de Mercado Pago con
 * renovación fallida (reembolsables), en reembolso o ya reembolsadas, las
 * más recientes primero. Las `refunding` estancadas se concilian FUERA del
 * camino de la petición (fire-and-forget, lote acotado): el GET responde de
 * inmediato con el estado actual de BD y, al cerrar cada conciliación, el
 * evento realtime `mp_order` hace que la sección se recargue sola.
 */
export async function listRefundOrders(): Promise<RefundOrderView[]> {
  const stuck = await pool.query<Record<string, unknown>>(
    `SELECT * FROM mp_orders
      WHERE method = 'mercadopago' AND status = 'refunding'
        AND updated_at < now() - ($1::bigint * interval '1 millisecond')
      ORDER BY updated_at ASC
      LIMIT 3`,
    [REFUND_RECONCILE_AFTER_MS]
  )
  for (const row of stuck.rows) {
    // Detached como el resto del módulo (webhook): un fallo se registra y no
    // bloquea la respuesta; las escrituras de la conciliación son idempotentes
    // (guardadas por `WHERE status = 'refunding'` y `ON CONFLICT`).
    settleStuckRefundingOrder(parseRow(row)).catch((error: unknown) =>
      logError(`reconcile_refunding_${String(row.id)}`, error)
    )
  }

  const result = await pool.query<RefundJoinRow>(
    `SELECT o.*, u.username AS buyer_username
       FROM mp_orders o
       LEFT JOIN users u ON u.id = o.buyer_user_id
      WHERE o.method = 'mercadopago'
        AND o.status IN ('renewal_failed', 'refunding', 'refunded')
      ORDER BY o.updated_at DESC
      LIMIT 20`
  )
  return result.rows.map(parseRefundRow)
}

/**
 * Reembolsa el cobro de una orden con renovación fallida: reclama la orden
 * hacia `refunding` (atómico: bloquea reintentos de renovación y dobles
 * clics), ejecuta el reembolso TOTAL en MP
 * (`POST /v1/payments/{payment_id}/refunds` con body vacío), registra la
 * auditoría en `mp_refunds` y cierra la orden como `refunded` (terminal: sin
 * reintento de renovación ni conciliación posterior).
 *
 * Con rechazo explícito de MP (4xx: saldo insuficiente, fuera de la ventana
 * de 180 días, etc.) la orden vuelve a `renewal_failed` conservando su error
 * original y el rechazo viaja al admin traducido. Con resultado desconocido
 * (timeout o error del upstream) la orden queda `refunding` y la
 * conciliación decide contra la API de MP si la devolución realmente se
 * ejecutó. Si el reembolso ya se ejecutó y falla la persistencia local, la
 * orden también queda `refunding`: la conciliación la cierra como `refunded`
 * nunca se revierte a `renewal_failed` con dinero en devolución.
 */
export async function refundOrder(params: {
  orderId: string
  adminUserId: string
  adminUsername: string
  reason: string | null
}): Promise<MpOrderRow> {
  const order = await getMpOrder(params.orderId)
  if (!order) {
    throw new MercadoPagoError(404, "not_found", "La orden no existe.")
  }
  if (order.method !== "mercadopago") {
    throw new MercadoPagoError(
      409,
      "invalid_order_method",
      "Solo se reembolsan cobros de Mercado Pago: las transferencias se rechazan antes de mover dinero y los cupones no cobran."
    )
  }
  if (order.payment_id === null) {
    throw new MercadoPagoError(
      409,
      "order_not_refundable",
      "La orden no tiene un pago de Mercado Pago asociado."
    )
  }
  if (order.status !== "renewal_failed") {
    throw new MercadoPagoError(
      409,
      "order_not_refundable",
      order.status === "refunded"
        ? "La orden ya fue reembolsada."
        : order.status === "refunding"
          ? "La orden ya tiene un reembolso en curso."
          : `Solo se reembolsan órdenes con renovación fallida (estado actual: ${order.status}).`
    )
  }

  const claim = await pool.query(
    `UPDATE mp_orders SET status = 'refunding', updated_at = now()
      WHERE id = $1 AND status = 'renewal_failed'`,
    [order.id]
  )
  if (claim.rowCount === 0) {
    throw new MercadoPagoError(
      409,
      "order_not_refundable",
      "La orden ya no está en renovación fallida."
    )
  }

  // Fase 1: llamada a MP. Aquí el resultado sí es clasificable: un rechazo
  // explícito (4xx) revierte a `renewal_failed`; timeout/red/5xx deja la
  // orden en `refunding` para que la conciliación resuelva el estado real.
  let refundResponse: MercadoPagoResponse<unknown>
  try {
    refundResponse = await mercadoPagoRequest<unknown>(
      `/v1/payments/${order.payment_id.toString()}/refunds`,
      { method: "POST" }
    )
  } catch (error) {
    const unknownOutcome =
      error instanceof MercadoPagoError &&
      (error.code === "timeout" ||
        error.code === "network_error" ||
        error.status >= 500)
    if (!unknownOutcome) {
      // Rechazo explícito de MP: volver a `renewal_failed` conservando el
      // error original de la renovación; el motivo del rechazo viaja al
      // admin en la respuesta y queda en el log.
      await pool.query(
        `UPDATE mp_orders SET status = 'renewal_failed', updated_at = now()
          WHERE id = $1 AND status = 'refunding'`,
        [order.id]
      )
      notifyOrderChange(order, "renewal_failed")
    }
    log("mercadopago.refund", {
      order_id: order.id,
      payment_id: order.payment_id,
      actor: `user:${params.adminUsername}`,
      outcome: unknownOutcome ? "unknown_refunding" : "rolled_back",
      reason:
        error instanceof Error
          ? error.message.slice(0, 300)
          : String(error).slice(0, 300),
    })
    throw error
  }

  // Fase 2: MP ya ejecutó el reembolso. Un fallo de base de datos aquí NO
  // revierte la orden (el dinero ya está en devolución): queda en `refunding`
  // y la conciliación la cierra como `refunded` con su fila de auditoría.
  try {
    const last = lastRefundFrom(refundResponse.data)
    const refundId = last && typeof last.id === "number" ? last.id : null
    const refundStatus =
      last && typeof last.status === "string" ? last.status : "pending"

    await pool.query(
      `INSERT INTO mp_refunds
         (id, order_id, payment_id, amount, currency, mp_refund_id, status, reason, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)
       ON CONFLICT (mp_refund_id) DO NOTHING`,
      [
        randomUUID(),
        order.id,
        order.payment_id,
        order.amount,
        order.currency,
        refundId,
        refundStatus,
        params.reason,
        params.adminUserId,
      ]
    )
    await pool.query(
      `UPDATE mp_orders
          SET status = 'refunded', refunded_at = now(), error = NULL, updated_at = now()
        WHERE id = $1 AND status = 'refunding'`,
      [order.id]
    )
    notifyOrderChange(order, "refunded")
    log("mercadopago.refund", {
      order_id: order.id,
      payment_id: order.payment_id,
      mp_refund_id: refundId,
      amount: order.amount,
      actor: `user:${params.adminUsername}`,
      outcome: "refunded",
    })
  } catch (error) {
    logError(`refund_persist_${order.id}`, error)
    throw error
  }

  const fresh = await getMpOrder(order.id)
  return fresh ?? order
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
