import { createHash } from "node:crypto"

import { pool } from "@/server/db"
import {
  checkRateLimitReceiptScan,
  extraerComprobanteDeArchivo,
  receiptScanConfigured,
  type ExtraccionLLM,
  type ScanResult,
} from "@/server/transferencias/scan"
import { evaluarCondiciones } from "@/server/transferencias/verificar"
import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"

import {
  getPaymentOrder,
  resolvePaymentOrder,
  savePaymentOrderScan,
  type PaymentOrder,
} from "./repository"

/*
 * Revisión del comprobante de una orden de pago: el MISMO motor del flujo
 * de transferencias (extracción LLM con RECEIPT_SCAN_MODEL + condiciones
 * determinísticas) pero sobre `payment_orders`:
 *
 *   1. Fecha dentro del mes actual.
 *   2. Concepto impreso con el código de la orden (el pagador lo recibió en
 *      la liga wa.me y lo escribió como concepto en su SPEI).
 *   3. Importe ≥ al monto libre congelado de la orden.
 *   4. Beneficiario tolerante contra el bankHolder del SNAPSHOT bancario
 *      del creador (la cuenta que él definió al crear la orden).
 *
 * Diferencias con las renovaciones (a propósito):
 *   - Sin guardia anti-doble-renovación (no hay renovación que duplicar).
 *   - Dedup sha256 GLOBAL sobre `payment_orders`: el pagador es anónimo, no
 *     hay buyer que acote — el mismo archivo nunca auto-aprueba dos órdenes.
 *   - Auto-rechazo NO sella la orden: queda 'pending' para el creador (es su
 *     cobro; él decide aprobar o rechazar con contexto).
 *   - El resultado se avisa al creador por campana (espejo WhatsApp) y al
 *     pagador DIRECTO por `wa_outbox` (kind 'payment_order', sin link al
 *     panel: no es usuario).
 */

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

/** Aviso al creador por campana (con espejo WhatsApp); nunca lanza. */
function notifyCreator(order: PaymentOrder, title: string, body: string): void {
  createPaymentOrderNotification({
    userId: order.creatorUserId,
    orderId: order.id,
    title,
    body,
  })
}

/**
 * Throttle de avisos al creador por (orden, sha del comprobante): mientras
 * una orden siga pendiente, reenvíos del MISMO archivo (re-encodes con sha
 * distinto escapan al dedup global) no deben generar campana + WhatsApp en
 * cada intento — con el mismo sha dentro de la ventana se silencia. Mapa en
 * memoria con poda (mismo patrón que los buckets de rate limit).
 */
const NOTIFY_THROTTLE_MS = 10 * 60_000
const notifyThrottle = new Map<string, { sha: string | null; at: number }>()

export function notifyPaymentOrderCreator(
  order: PaymentOrder,
  ticketSha256: string | null,
  title: string,
  body: string
): void {
  const now = Date.now()
  if (notifyThrottle.size > 500) {
    for (const [key, entry] of notifyThrottle) {
      if (now - entry.at > NOTIFY_THROTTLE_MS) notifyThrottle.delete(key)
    }
  }
  const last = notifyThrottle.get(order.id)
  if (
    last &&
    last.sha === ticketSha256 &&
    now - last.at < NOTIFY_THROTTLE_MS
  ) {
    return
  }
  notifyThrottle.set(order.id, { sha: ticketSha256, at: now })
  notifyCreator(order, title, body)
}

/** Confirmación DIRECTA al pagador por WhatsApp; nunca lanza. */
function notifyPayer(
  order: PaymentOrder,
  title: string,
  body: string
): void {
  if (!order.payerPhone) return
  void enqueueWhatsAppForPhone({
    userId: order.creatorUserId,
    phone: order.payerPhone,
    kind: WHATSAPP_KIND_PAYMENT_ORDER,
    title,
    body,
  })
}

export type PaymentReviewOutcome =
  | { review: "auto_approved" }
  | { review: "auto_rejected"; scan: ScanResult }
  | { review: "manual"; scan: ScanResult | null }
  | { review: "already_resolved"; status: PaymentOrder["status"] }
  | {
      review: "not_a_receipt"
      scan: ScanResult
    }

/**
 * Cuota de escaneo del pagador por teléfono (bucket propio del módulo,
 * misma mecánica de 3/min del flujo de transferencias). La chequea el
 * llamador UNA vez por envío, antes de gastar visión.
 */
export function checkPaymentOrderScanQuota(phone: string): boolean {
  return checkRateLimitReceiptScan(`orden-pago:${phone}`)
}

/**
 * Revisa el comprobante contra la orden. Nunca lanza: ante fallos de
 * infraestructura devuelve `manual` y la orden queda 'pending' con el
 * ticket guardado para la revisión del creador.
 */
export async function reviewPaymentReceipt(input: {
  order: PaymentOrder
  bytes: Uint8Array
  mimeType: string
  /** Archivo ya guardado en user_files a nombre del creador. */
  ticketFileId: string
  /** Extracción ya corrida por el llamador para descubrir la orden. */
  preextracted?: ExtraccionLLM
}): Promise<PaymentReviewOutcome> {
  const order = input.order
  const holderName = order.bank.holder.trim()
  if (!receiptScanConfigured() || holderName.length === 0) {
    return { review: "manual", scan: null }
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex")

  let extraccion: ExtraccionLLM | null = input.preextracted ?? null
  if (extraccion === null) {
    try {
      extraccion = await extraerComprobanteDeArchivo({
        bytes: input.bytes,
        mimeType: input.mimeType,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const scan: ScanResult = {
        ok: false,
        esComprobante: false,
        checks: [],
        reasons: [],
        duplicate: false,
        advertencias: [],
        datos: null,
        modelo: process.env.RECEIPT_SCAN_MODEL?.trim() ?? "",
        error: message,
      }
      await savePaymentOrderScan({
        orderId: order.id,
        scanStatus: "error",
        scanResult: scan as unknown as Record<string, unknown>,
        scanModel: scan.modelo,
        ticketFileId: input.ticketFileId,
        ticketSha256: sha256,
      }).catch(() => {})
      logEvent("orden_pago.review_scan_error", {
        order_id: order.id,
        code: order.code,
        error: message,
      })
      return { review: "manual", scan }
    }
  }

  // El archivo no es un comprobante (o es ilegible en su totalidad): NO se
  // liga a la orden ni la sella — el pagador subió algo equivocado y puede
  // reintentar con la foto correcta.
  if (!extraccion.esComprobante || extraccion.datos === null) {
    logEvent("orden_pago.review_not_receipt", {
      order_id: order.id,
      code: order.code,
    })
    return {
      review: "not_a_receipt",
      scan: {
        ok: false,
        esComprobante: false,
        checks: [],
        reasons: [],
        duplicate: false,
        advertencias: extraccion.advertencias,
        datos: null,
        modelo: extraccion.modelo,
        error: null,
      },
    }
  }

  const checks = evaluarCondiciones({
    datos: extraccion.datos,
    conceptCode: order.code,
    amountMxn: order.amountMxn,
    holderName,
  })
  const reasons = checks
    .filter((check) => !check.passed)
    .map((check) => check.label)

  // Dedup GLOBAL por huella: el mismo comprobante ya usado en OTRA orden de
  // pago no auto-aprueba esta (reenvíos del mismo archivo a la MISMA orden
  // pasan: el id propio está excluido).
  let duplicate = false
  if (reasons.length === 0) {
    const dup = await pool.query(
      `SELECT 1 FROM payment_orders
        WHERE ticket_sha256 = $1 AND id <> $2::uuid
        LIMIT 1`,
      [sha256, order.id]
    )
    if ((dup.rowCount ?? 0) > 0) {
      duplicate = true
      reasons.push("Este comprobante ya fue registrado en otra orden de pago.")
      logEvent("orden_pago.review_duplicate", { order_id: order.id })
    }
  }

  const scan: ScanResult = {
    ok: reasons.length === 0,
    esComprobante: true,
    checks,
    reasons,
    duplicate,
    advertencias: extraccion.advertencias,
    datos: extraccion.datos,
    modelo: extraccion.modelo,
    error: null,
  }

  const pagador = order.payerPhone ? ` (WhatsApp ${maskPhone(order.payerPhone)})` : ""

  if (!scan.ok) {
  const persisted = await savePaymentOrderScan({
    orderId: order.id,
    scanStatus: "rejected",
    scanResult: scan as unknown as Record<string, unknown>,
    scanModel: extraccion.modelo,
    ticketFileId: input.ticketFileId,
    ticketSha256: sha256,
  }).catch(() => false)
  logEvent("orden_pago.review_rejected", {
    order_id: order.id,
    code: order.code,
    reasons,
    persisted,
  })
  notifyPaymentOrderCreator(
    order,
    sha256,
    "Orden de pago por revisar",
    `El comprobante del pagador${pagador} de tu orden ${order.code} (${money(
      order.amountMxn
    )}) no pasó la validación automática.${
      reasons.length > 0 ? ` Motivo(s): ${reasons.slice(0, 4).join("; ")}.` : ""
    } Revísala en Módulos → Orden de pago.`
  )
  return { review: "auto_rejected", scan }
  }

  const persisted = await savePaymentOrderScan({
    orderId: order.id,
    scanStatus: "approved",
    scanResult: scan as unknown as Record<string, unknown>,
    scanModel: extraccion.modelo,
    ticketFileId: input.ticketFileId,
    ticketSha256: sha256,
  }).catch(() => false)
  if (!persisted) {
    // Sin la evidencia persistida no hay aprobación automática: revisión del
    // creador (el ticket sí quedó guardado).
    return { review: "manual", scan }
  }

  const resolved = await resolvePaymentOrder({
    orderId: order.id,
    decision: "paid",
    reviewedBy: order.creatorUserId,
  }).catch(() => null)
  if (!resolved) {
    // Otro actor (creador, admin o un reenvío concurrente) la resolvió
    // primero: responder el estado REAL de la orden, sin segundo aviso.
    const current = await getPaymentOrder(order.id).catch(() => null)
    return {
      review: "already_resolved",
      status: current?.status ?? order.status,
    }
  }

  logEvent("orden_pago.review_approved", {
    order_id: order.id,
    code: order.code,
    amount: order.amountMxn,
  })
  notifyCreator(
    order,
    "Cobro recibido",
    `El pagador${pagador} de tu orden ${order.code} pagó ${money(
      order.amountMxn
    )}: el comprobante pasó la validación automática (fecha, concepto, importe y beneficiario).`
  )
  notifyPayer(
    order,
    "Pago confirmado",
    `Recibimos tu comprobante: el pago de ${money(order.amountMxn)} con el código ${
      order.code
    } quedó confirmado. Gracias.`
  )
  return { review: "auto_approved" }
}
