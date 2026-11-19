import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import { resolvePaymentOrderDepositToken } from "@/server/mercadopago/tokens"
import { paymentOrderMoney } from "@/lib/ligas-pago"

import { tryConfirmOrderDeposit } from "./deposit-check"
import {
  notifyDepositConfirmed,
  notifyDepositAutoConfirmed,
} from "./notify"
import {
  listDueVerifyingOrders,
  listDuePendingOrders,
  markDepositEscalated,
  savePaymentOrderDepositCheck,
  type PaymentOrder,
} from "./repository"

/*
 * Verificador en background de depósitos de órdenes de pago, en DOS
 * carriles:
 *
 *  - 'verifying' (comprobante válido de un creador CON credencial
 *    consultable): se confirma cuando su depósito aparece acreditado en la
 *    cuenta de Mercado Pago del creador (misma fuente que el reporte SPEI).
 *    Sondea la cola `deposit_next_check_at <= now()` con backoff (45 s ×6
 *    → 2 min ×6 → 5 min ×6 → 15 min, también para fallos de infraestructura)
 *    y, tras 24 h sin hallazgo, escala UNA sola vez a resolución manual
 *    avisando a creador (campana) y pagador (WhatsApp) — la orden queda
 *    'verifying' para que el creador resuelva (Marcar pagada / Rechazar /
 *    Cancelar). Sin credencial para la cuenta del creador no hay consulta
 *    (las órdenes reprograman a 15 min y escalan por edad): jamás se
 *    auto-aprueba a ciegas.
 *
 *  - 'pending' (SIN comprobante, creador con credencial): el pagador NO
 *    necesita enviar comprobante — si el depósito de la orden se acredita
 *    por importe exacto + ventana con COINCIDENCIA ÚNICA (ninguna otra
 *    orden activa del mismo importe cubre el depósito; guarda re-verificada
 *    dentro del candado del claim), la orden se confirma sola a 'paid' y
 *    salen los avisos automáticos a cobrador y pagador. Mismo backoff, sin
 *    escalamiento (no hay comprobante prometido: pagar tarde es normal) y
 *    tope de edad de 72 h (la cola deja de sondear; el comprobante y el
 *    creador siguen siendo caminos válidos). El comprobante sigue
 *    funcionando igual: desambigua por código impreso y respalda casos
 *    donde la unicidad no se cumple.
 *
 * Arranque: `src/instrumentation.ts` (hook `register`, runtime Node), mismo
 * patrón del scheduler de alertas: intervalo de 15 s, guard `ticking` contra
 * solapamiento (cada orden puede tardar hasta el presupuesto de MP). El
 * tick corto acota la FASE de sondeo (el desfase entre la acreditación del
 * depósito y el reclamo observado en producción, caso BPKE: 43 s = primer
 * sondeo a +2 min + fase de tick de 60 s); el ritmo POR ORDEN lo manda el
 * backoff, así que el tick corto no multiplica las llamadas a MP.
 */

const TICK_MS = 15_000

/** Órdenes 'verifying' verificadas por pasada. */
const MAX_PER_TICK = 4

/** Órdenes 'pending' (carril sin comprobante) por pasada. */
const MAX_PENDING_PER_TICK = 2

/** Sondeos en paralelo por pasada. */
const CONCURRENCY = 2

/** Tope de espera del depósito antes de escalar a resolución manual. */
const ESCALATE_AFTER_MS = 24 * 60 * 60_000

/** Sin credencial de MP (o fallo de consulta): reprogra y reintenta luego. */
const NO_CREDENTIAL_DELAY_MS = 15 * 60_000

/**
 * Backoff por intentos acumulados sin hallazgo. Denso en la VENTANA
 * CRÍTICA (el pagador pide la liga y paga en los minutos siguientes —
 * caso BPKE: acreditó 94 s después de la solicitud): 45 s ×6 cubre los
 * primeros ~4.5 min con desfase ≤45 s; después se relaja 2 min ×6 (~18
 * min), 5 min ×6 (~48 min) y 15 min en adelante (72 h de ventana del
 * carril pending; el comprobante y el creador siguen siendo caminos
 * válidos). El presupuesto total de llamadas a MP por orden queda igual
 * al esquema anterior: se redistribuye hacia el inicio.
 */
function nextDelayMs(checks: number): number {
  if (checks < 6) return 45_000
  if (checks < 12) return 2 * 60_000
  if (checks < 18) return 5 * 60_000
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
 * Verifica UNA orden: en 'verifying' el escalamiento por edad primero
 * (siempre disponible, aun sin credencial de MP), después la consulta de
 * depósito; en el carril 'pending' no hay escalamiento y el claim exige
 * coincidencia única. Nunca lanza.
 */
async function verifyOrder(
  order: PaymentOrder,
  options: { uniqueOnly: boolean }
): Promise<void> {
  const source = options.uniqueOnly ? "pending_poll" : "verificador"
  const sinceMs = order.verifyingSince
    ? Date.parse(order.verifyingSince)
    : Date.now()
  const waitingMs = Date.now() - (Number.isNaN(sinceMs) ? Date.now() : sinceMs)

  if (!options.uniqueOnly && waitingMs >= ESCALATE_AFTER_MS) {
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
    confirmed = await tryConfirmOrderDeposit({
      order,
      accessToken,
      uniqueOnly: options.uniqueOnly,
    })
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
      source,
      checks: order.depositChecks,
      receipt_free: options.uniqueOnly,
      waiting_ms: Math.max(waitingMs, 0),
    })
    if (options.uniqueOnly) {
      notifyDepositAutoConfirmed(confirmed)
    } else {
      notifyDepositConfirmed(confirmed)
    }
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
    lane: source,
  })
}

/** Pasada del verificador con concurrencia acotada. Nunca lanza. */
async function verifyTick(): Promise<void> {
  const [due, duePending] = await Promise.all([
    listDueVerifyingOrders(MAX_PER_TICK).catch(() => []),
    listDuePendingOrders(MAX_PENDING_PER_TICK).catch(() => []),
  ])
  if (due.length === 0 && duePending.length === 0) return
  const jobs = [
    ...due.map((order) => ({ order, uniqueOnly: false })),
    ...duePending.map((order) => ({ order, uniqueOnly: true })),
  ]
  let index = 0
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, jobs.length) },
    async () => {
      while (index < jobs.length) {
        const current = jobs[index]
        index += 1
        await verifyOrder(current.order, {
          uniqueOnly: current.uniqueOnly,
        }).catch(() => {})
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
