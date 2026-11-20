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
import { notifyCreator, notifyDepositConfirmed } from "./notify"

import {
  getPaymentOrder,
  markPaymentOrderVerifying,
  savePaymentOrderScan,
  type PaymentOrder,
} from "./repository"
import { tryConfirmOrderDeposit } from "./deposit-check"
import { resolvePaymentOrderDepositToken } from "@/server/mercadopago/tokens"

/*
 * Revisión del comprobante de una orden de pago: el MISMO motor de
 * extracción LLM del flujo de transferencias (RECEIPT_SCAN_MODEL) pero con
 * la validación REDUCIDA del cobro libre (`evaluarCondiciones` modo
 * "pago_libre"):
 *
 *  1. Concepto impreso con el código de la orden (el pagador lo recibió en
 *      el link corto spei.link y lo escribió como concepto en su SPEI).
 *   2. Importe EXACTO al monto congelado de la orden (a centavos — el mismo
 *      criterio del casado del depósito).
 *
 * Fecha y beneficiario NO se evalúan: el comprobante de un pagador externo
 * no siempre los imprime, y la confirmación real del dinero la da el
 * DEPÓSITO acreditado en la cuenta (ver deposit-check.ts), no el papel.
 * Las renovaciones de FlujoTV conservan la validación completa.
 *
 * Con el comprobante válido la orden NO se declara `paid`. GATE DE CUENTA:
 * la verificación de depósito consulta la cuenta de Mercado Pago donde el
 * pagador depositó — la del SNAPSHOT del creador — y solo es posible con
 * una credencial que la vea:
 *
 *   - CREADOR CON CREDENCIAL (propia del distribuidor o la de plataforma
 *     para el admin): la orden pasa a 'verifying' y solo se resuelve cuando
 *     el DEPÓSITO aparece acreditado (misma fuente que
 *     /modulos/reporte-spei; MP no expone el concepto escrito por el
 *     pagador, así que el depósito se casa por importe exacto + ventana y
 *     el ID queda reservado en exclusiva — ver deposit-check.ts). Chequeo
 *     inmediato con presupuesto corto dentro del turno; si no acredita, el
 *     verificador en background (deposit-verifier.ts) sondea con backoff y
 *     publica el resultado por WhatsApp.
 *   - DISTRIBUIDOR SIN TOKEN PROPIO: el pagador paga a la CLABE del
 *     snapshot del creador, cuenta que ninguna credencial consultable
 *     alcanza — la verificación automática no aplica: el comprobante válido
 *     queda en la orden (outcome `awaiting_creator`), campana al creador
 *     para confirmar la recepción en SU cuenta y resolver manualmente.
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

/** Presupuesto del chequeo inmediato de depósito dentro del turno. */
const IMMEDIATE_DEPOSIT_BUDGET_MS = 8_000

/** Timeout por página del chequeo inmediato (acota el peor caso del turno). */
const IMMEDIATE_PAGE_TIMEOUT_MS = 5_000

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
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

export type PaymentReviewOutcome =
  | { review: "auto_approved" }
  | { review: "verifying_deposit" }
  | { review: "awaiting_creator" }
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
  return checkRateLimitReceiptScan(`links-pago:${phone}`)
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
  if (!receiptScanConfigured()) {
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
    modo: "pago_libre",
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
      reasons.push("Este comprobante ya fue registrado en otro link de pago.")
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
    "Link de pago por revisar",
    `El comprobante del pagador${pagador} de tu orden ${order.code} (${money(
      order.amountMxn
    )}) no pasó la validación automática.${
      reasons.length > 0 ? ` Motivo(s): ${reasons.slice(0, 4).join("; ")}.` : ""
    } Revísala en Módulos → Links de pago.`
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

  // GATE DE CUENTA: la verificación de depósito requiere una credencial que
  // vea la cuenta receptora del creador (propia del distribuidor o la de
  // plataforma para el admin). Sin ella el comprobante válido queda en la
  // orden (sigue 'pending') y el creador confirma la recepción en SU cuenta
  // y resuelve manualmente.
  const accessToken = await resolvePaymentOrderDepositToken(
    order.creatorUserId
  ).catch(() => null)
  if (!accessToken) {
    logEvent("orden_pago.review_approved_creator", {
      order_id: order.id,
      code: order.code,
      amount: order.amountMxn,
    })
    notifyCreator(
      order,
      "Comprobante validado",
    `El pagador${pagador} de tu orden ${order.code} (${money(
      order.amountMxn
    )}) envió un comprobante válido (concepto e importe). Confirma la recepción del depósito en TU cuenta y marca el link como pagado en Módulos → Links de pago.`
    )
    return { review: "awaiting_creator" }
  }

  // El comprobante válido pasa la orden a VERIFICACIÓN DE DEPÓSITO (el
  // código sigue reservado: verifying es activa, no resuelta). Null = otro
  // actor (creador, admin, reenvío concurrente) la resolvió primero:
  // responder el estado REAL sin segundo aviso.
  const verifying = await markPaymentOrderVerifying(order.id).catch(() => null)
  if (!verifying) {
    const current = await getPaymentOrder(order.id).catch(() => null)
    return {
      review: "already_resolved",
      status: current?.status ?? order.status,
    }
  }

  // Chequeo INMEDIATO con presupuesto corto: el pago suele ser previo al
  // comprobante, así que el depósito puede estar ya acreditado y la
  // confirmación sale al instante. Si aún no acredita, el verificador en
  // background sondea con backoff (el primer poll queda agendado a +2 min
  // por markPaymentOrderVerifying) y publica el resultado por WhatsApp.
  const confirmed = await tryConfirmOrderDeposit({
    order: verifying,
    budgetMs: IMMEDIATE_DEPOSIT_BUDGET_MS,
    pageTimeoutMs: IMMEDIATE_PAGE_TIMEOUT_MS,
    accessToken,
  }).catch(() => null)

  if (confirmed) {
    logEvent("orden_pago.deposit_confirmed", {
      order_id: order.id,
      code: order.code,
      amount: order.amountMxn,
      mp_payment_id: confirmed.mpPaymentId,
      source: "inmediato",
    })
    notifyDepositConfirmed(confirmed)
    return { review: "auto_approved" }
  }

  // Carrera con el verificador o con una resolución manual: si la orden ya
  // no está en verificación, responder el estado REAL en lugar de anunciar
  // "esperando depósito" para un pago ya confirmado.
  const current = await getPaymentOrder(order.id).catch(() => null)
  if (current && current.status !== "verifying") {
    return { review: "already_resolved", status: current.status }
  }

  logEvent("orden_pago.review_verifying", {
    order_id: order.id,
    code: order.code,
    amount: order.amountMxn,
  })
  notifyCreator(
    order,
    "Comprobante validado, esperando depósito",
    `El pagador${pagador} envió un comprobante válido para tu orden ${order.code} (${money(
      order.amountMxn
    )}). Falta ver la acreditación del depósito en tu cuenta; te avisamos al confirmarse (si en 24 h no aparece, la orden pasa a revisión manual).`
  )
  return { review: "verifying_deposit" }
}
