import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import { resolvePaymentOrderDepositToken } from "@/server/mercadopago/tokens"
import { paymentOrderMoney } from "@/lib/ligas-pago"

import { tryConfirmOrderDeposit } from "./deposit-check"
import { notifyDepositConfirmed } from "./review"
import {
  listDueVerifyingOrders,
  markDepositEscalated,
  savePaymentOrderDepositCheck,
  type PaymentOrder,
} from "./repository"

/*
 * Verificador en background de depósitos de órdenes de pago: una orden en
 * 'verifying' (comprobante válido de un creador CON credencial consultable
 * — la cola excluye al resto, cuyo cobro apunta a una cuenta sin credencial)
 * se confirma cuando su depósito aparece acreditado en la cuenta de Mercado
 * Pago del creador (misma fuente que el reporte SPEI). Sondea la cola
 * `deposit_next_check_at <= now()` con backoff (2 → 5 → 15 min, también
 * para fallos de infraestructura) y, tras 24 h sin hallazgo, escala UNA
 * sola vez a resolución manual avisando a creador (campana) y pagador
 * (WhatsApp) — la orden queda 'verifying' para que el creador resuelva
 * (Marcar pagada / Rechazar / Cancelar).
 *
 * Sin credencial para la cuenta del creador no hay consulta (las órdenes
 * reprograman a 15 min y escalan por edad): jamás se auto-aprueba a ciegas.
 *
 * Arranque: `src/instrumentation.ts` (hook `register`, runtime Node), mismo
 * patrón del scheduler de alertas: intervalo de 60 s, guard `ticking` contra
 * solapamiento (cada orden puede tardar hasta el presupuesto de MP).
 */

const TICK_MS = 60_000

/** Órdenes verificadas por pasada. */
const MAX_PER_TICK = 4

/** Sondeos en paralelo por pasada. */
const CONCURRENCY = 2

/** Tope de espera del depósito antes de escalar a resolución manual. */
const ESCALATE_AFTER_MS = 24 * 60 * 60_000

/** Sin credencial de MP (o fallo de consulta): reprogra y reintenta luego. */
const NO_CREDENTIAL_DELAY_MS = 15 * 60_000

/** Backoff por intentos acumulados sin hallazgo: 2 min ×3, 5 min ×6, 15 min+. */
function nextDelayMs(checks: number): number {
  if (checks < 3) return 2 * 60_000
  if (checks < 9) return 5 * 60_000
  return 15 * 60_000
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

/** Aviso de escalamiento a manual: creador (campana) + pagador (WhatsApp). */
function notifyEscalated(order: PaymentOrder): void {
  createPaymentOrderNotification({
    userId: order.creatorUserId,
    orderId: order.id,
    title: "Liga de pago sin depósito",
    body: `Tu orden ${order.code} (${paymentOrderMoney(
      order.amountMxn
    )}) tiene comprobante válido pero el depósito no aparece acreditado en tu cuenta tras 24 h de verificación. Resuélvela manualmente en Módulos → Ligas de pago (Marcar pagada o Rechazar).`,
  })
  if (order.payerPhone) {
    void enqueueWhatsAppForPhone({
      userId: order.creatorUserId,
      phone: order.payerPhone,
      kind: WHATSAPP_KIND_PAYMENT_ORDER,
      title: "Pago en revisión",
      body: `Aún no registramos la acreditación del depósito de ${paymentOrderMoney(
        order.amountMxn
      )} con el código ${order.code} (puede tardar según tu banco). Tu pago pasó a revisión: quien te emitió la orden te confirmará por este chat.`,
    })
  }
}

/**
 * Verifica UNA orden: escalamiento por edad primero (siempre disponible,
 * aun sin credencial de MP), después la consulta de depósito. Nunca lanza.
 */
async function verifyOrder(order: PaymentOrder): Promise<void> {
  const sinceMs = order.verifyingSince ? Date.parse(order.verifyingSince) : Date.now()
  const waitingMs = Date.now() - (Number.isNaN(sinceMs) ? Date.now() : sinceMs)

  if (waitingMs >= ESCALATE_AFTER_MS) {
    const escalated = await markDepositEscalated(order.id).catch(() => false)
    if (escalated) {
      logEvent("orden_pago.deposit_escalated", {
        order_id: order.id,
        code: order.code,
        amount: order.amountMxn,
        checks: order.depositChecks,
        waiting_ms: waitingMs,
      })
      notifyEscalated(order)
    }
    return
  }

  const accessToken = await resolvePaymentOrderDepositToken(
    order.creatorUserId
  ).catch(() => null)
  if (!accessToken) {
    // Sin credencial para la cuenta del creador no hay verificación posible:
    // reprogra para que el escalamiento por edad siga corriendo (jamás se
    // aprueba a ciegas).
    await savePaymentOrderDepositCheck({
      orderId: order.id,
      checks: order.depositChecks + 1,
      nextCheckAt: new Date(Date.now() + NO_CREDENTIAL_DELAY_MS),
    }).catch(() => {})
    return
  }

  let confirmed: PaymentOrder | null = null
  try {
    confirmed = await tryConfirmOrderDeposit({ order, accessToken })
  } catch (error) {
    // Fallo de MP/BD: cuenta como intento fallido para el backoff (la edad
    // sigue mandando el escalamiento a 24 h) — una credencial roja o MP
    // caído no debe significar un sondeo por minuto durante todo el tope.
    logEvent("orden_pago.deposit_check_failed", {
      order_id: order.id,
      code: order.code,
      error: error instanceof Error ? error.message : String(error),
    })
    const checks = order.depositChecks + 1
    await savePaymentOrderDepositCheck({
      orderId: order.id,
      checks,
      nextCheckAt: new Date(Date.now() + nextDelayMs(checks)),
    }).catch(() => {})
    return
  }

  if (confirmed) {
    logEvent("orden_pago.deposit_confirmed", {
      order_id: order.id,
      code: order.code,
      amount: order.amountMxn,
      mp_payment_id: confirmed.mpPaymentId,
      source: "verificador",
      checks: order.depositChecks,
      waiting_ms: waitingMs,
    })
    notifyDepositConfirmed(confirmed)
    return
  }

  const checks = order.depositChecks + 1
  await savePaymentOrderDepositCheck({
    orderId: order.id,
    checks,
    nextCheckAt: new Date(Date.now() + nextDelayMs(checks)),
  }).catch(() => {})
  logEvent("orden_pago.deposit_check", {
    order_id: order.id,
    code: order.code,
    checks,
    waiting_ms: waitingMs,
  })
}

/** Pasada del verificador con concurrencia acotada. Nunca lanza. */
async function verifyTick(): Promise<void> {
  const due = await listDueVerifyingOrders(MAX_PER_TICK).catch(() => [])
  if (due.length === 0) return
  let index = 0
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, due.length) },
    async () => {
      while (index < due.length) {
        const current = due[index]
        index += 1
        await verifyOrder(current).catch(() => {})
      }
    }
  )
  await Promise.all(workers)
}

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await verifyTick()
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `orden-pago: deposit-verifier: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  } finally {
    ticking = false
  }
}

/** Arranca el verificador una sola vez por proceso (idempotente). */
export function startPaymentOrderDepositVerifier(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  // Node: el timer no debe mantener vivo el proceso por sí solo (builds,
  // scripts); en runtime el servidor pm2 ya lo mantiene arriba.
  const handle = timer as unknown as { unref?: () => void }
  handle.unref?.()
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "orden_pago.deposit_verifier_started",
      tick_ms: TICK_MS,
    })
  )
}
