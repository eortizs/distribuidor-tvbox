import { enqueueWhatsAppForPhone, WHATSAPP_KIND_PAYMENT_ORDER } from "@/server/whatsapp/service"
import { createPaymentOrderNotification } from "@/server/notifications/service"
import {
  resolvePaymentOrderDepositToken,
  resolveSellerMpAccessToken,
} from "@/server/mercadopago/tokens"
import { findDepositsForPaymentOrderWindow } from "@/server/mercadopago/spei"
import { paymentOrderMoney } from "@/lib/ligas-pago"

import { tryConfirmOrderDeposit, tryConfirmDepositPayment } from "./deposit-check"
import {
  notifyDepositConfirmed,
  notifyDepositAutoConfirmed,
} from "./notify"
import {
  listDueVerifyingOrders,
  listDuePendingOrders,
  listDepositSweeperAccounts,
  markDepositEscalated,
  savePaymentOrderDepositCheck,
  type DepositSweeperAccount,
  type PaymentOrder,
} from "./repository"

/*
 * Verificador en background de depósitos de órdenes de pago, en DOS
 * mecanismos por tick (el BARRIDO primero, siempre):
 *
 *  - BARRIDO POR DEPÓSITO (reacción rápida): UNA búsqueda de MP por cuenta
 *    receptora con órdenes activas trae los depósitos recién acreditados
 *    (ventana de 2 min) y casa CADA uno contra las órdenes de ESA cuenta
 *    (importe exacto + ventana + coincidencia única). La latencia entre la
 *    acreditación (visible en MP al instante — el reporte SPEI la enseña en
 *    segundos) y el reclamo queda acotada a la FASE DEL TICK (≤10 s), y el
 *    presupuesto de MP es CONSTANTE: 1 búsqueda por cuenta por tick, no una
 *    por orden (caso BPKE: 43 s de desfase con el esquema por orden).
 *
 *  - CARRILES POR ORDEN (fallback): sondean `deposit_next_check_at` con
 *    backoff (45 s ×6 → 2 min ×6 → 5 min ×6 → 15 min) y cubren lo que el
 *    barrido no ve (reinicios, ventanas largas, órdenes que ya pasaron la
 *    ventana de 2 min del barrido):
 *    - 'verifying' (comprobante válido): escalamiento a manual tras 24 h.
 *    - 'pending' (sin comprobante): sin escalamiento, tope de edad 72 h;
 *      el claim exige coincidencia única (misma guarda que el barrido).
 *
 * Arranque: `src/instrumentation.ts` (hook `register`, runtime Node), mismo
 * patrón del scheduler de alertas: intervalo de 10 s, guard `ticking`
 * contra solapamiento (cada orden puede tardar hasta el presupuesto de MP).
 */

const TICK_MS = 10_000

/** Ventana del barrido: depósitos acreditados recientemente. */
const SWEEP_WINDOW_MS = 2 * 60_000

/** Presupuesto de la búsqueda del barrido (ventana corta: 1 página/riel). */
const SWEEP_BUDGET_MS = 6_000

/** Timeout por página del barrido (acota el tick). */
const SWEEP_PAGE_TIMEOUT_MS = 4_000

/** Memoria de depósitos ya procesados por el barrido (evita recasar por tick). */
const SWEEP_SEEN_TTL_MS = 5 * 60_000
const sweepSeen = new Map<string, number>()

/** Throttle del log de fallos del barrido por cuenta (MP caído no inundue el log). */
const SWEEP_FAIL_LOG_THROTTLE_MS = 60_000
const sweepFailLoggedAt = new Map<string, number>()

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

/**
 * Barrido de UNA cuenta: busca los depósitos acreditados en la ventana
 * corta y casa cada uno (no visto antes) contra las órdenes de ESA cuenta.
 * Nunca lanza.
 */
async function sweepAccount(account: DepositSweeperAccount): Promise<void> {
  const accessToken = await resolveSellerMpAccessToken(
    account.sellerUserId
  ).catch(() => null)
  if (!accessToken) return

  const deposits = await findDepositsForPaymentOrderWindow({
    beginIso: new Date(Date.now() - SWEEP_WINDOW_MS).toISOString(),
    endIso: new Date().toISOString(),
    budgetMs: SWEEP_BUDGET_MS,
    pageTimeoutMs: SWEEP_PAGE_TIMEOUT_MS,
    accessToken,
  })

  for (const deposit of deposits) {
    if (deposit.id.length === 0) continue
    const key = `${account.sellerUserId ?? "platform"}:${deposit.id}`
    if (sweepSeen.has(key)) continue
    sweepSeen.set(key, Date.now())

    const match = await tryConfirmDepositPayment({
      mpPaymentId: deposit.id,
      amountMxn: deposit.amountMxn,
      dateApproved: deposit.dateApproved,
      sellerUserId: account.sellerUserId,
    }).catch(() => null)
    if (match === null) continue

    logEvent("orden_pago.deposit_confirmed", {
      order_id: match.order.id,
      code: match.order.code,
      amount: match.order.amountMxn,
      mp_payment_id: match.order.mpPaymentId,
      source: "sweeper",
      seller: account.sellerUserId ?? "platform",
      checks: match.order.depositChecks,
      receipt_free: !match.hadReceipt,
    })
    if (match.hadReceipt) {
      notifyDepositConfirmed(match.order)
    } else {
      notifyDepositAutoConfirmed(match.order)
    }
  }
}

/** Barrido por depósito de todas las cuentas con órdenes activas. Nunca lanza. */
async function sweepTick(): Promise<void> {
  const accounts = await listDepositSweeperAccounts().catch(() => [])
  if (accounts.length === 0) return

  const now = Date.now()
  if (sweepSeen.size > 1000) {
    for (const [key, at] of sweepSeen) {
      if (now - at > SWEEP_SEEN_TTL_MS) sweepSeen.delete(key)
    }
  }

  for (const account of accounts) {
    await sweepAccount(account).catch((error: unknown) => {
      const seller = account.sellerUserId ?? "platform"
      const last = sweepFailLoggedAt.get(seller) ?? 0
      if (Date.now() - last < SWEEP_FAIL_LOG_THROTTLE_MS) return
      sweepFailLoggedAt.set(seller, Date.now())
      logEvent("orden_pago.sweep_failed", {
        seller,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    // Barrido primero: reacción en la fase del tick; los carriles por orden
    // son el fallback (backoff) para lo que la ventana corta no cubre.
    await sweepTick()
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
