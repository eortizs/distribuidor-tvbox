import {
  createAdminTransferEscalatedNotification,
  createClientRenewalNotice,
} from "@/server/notifications/service"

import {
  TRANSFER_DEPOSIT_ESCALATE_AFTER_MS,
  TRANSFER_DEPOSIT_NO_CREDENTIAL_DELAY_MS,
  listDueVerifyingTransferOrders,
  markTransferDepositEscalated,
  saveTransferOrderDepositCheck,
  transferDepositNextDelayMs,
  type MpOrderRow,
} from "./service"
import { resolveRenewalDepositToken, tryConfirmRenewalDeposit } from "./transfer-deposit"
import { runTickPerTenant } from "@/server/tenant/scheduler"

/*
 * Verificador en background de depósitos de RENOVACIONES por transferencia:
 * una orden en 'verifying' (comprobante validado por el escaneo y cuenta
 * receptora con credencial consultable — credencial propia del distribuidor
 * o la de plataforma) se aprueba cuando su depósito aparece acreditado en la
 * cuenta de Mercado Pago del vendedor (misma fuente que el reporte SPEI).
 * Sondea la cola `deposit_next_check_at <= now()` con backoff (2 → 5 →
 * 15 min, también para fallos de infraestructura o de credencial) y, tras
 * 24 h sin hallazgo, devuelve la orden a 'pending' UNA sola vez (revisión
 * manual del admin, el flujo de siempre) avisando a comprador (campana) y
 * admins («Transferencia por revisar»).
 *
 * Sin credencial para la cuenta receptora no hay consulta (las órdenes
 * reprograman a 15 min y escalan por edad): jamás se auto-aprueba a ciegas.
 *
 * Arranque: `src/instrumentation.ts` (hook `register`, runtime Node), mismo
 * patrón del verificador de links de pago: intervalo de 60 s, guard
 * `ticking` contra solapamiento.
 */

const TICK_MS = 60_000

/** Órdenes verificadas por pasada. */
const MAX_PER_TICK = 4

/** Sondeos en paralelo por pasada. */
const CONCURRENCY = 2

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

/** Aviso de escalamiento a manual: comprador (campana) + admins (cola). */
function notifyEscalated(order: MpOrderRow): void {
  if (order.buyer_user_id) {
    createClientRenewalNotice({
      userId: order.buyer_user_id,
      title: "Renovación en revisión manual",
      body: `El comprobante de ${order.user_name} pasó la validación automática, pero el depósito no apareció acreditado en la cuenta receptora tras 24 h. Quedó en revisión manual del administrador.`,
    })
  }
  void createAdminTransferEscalatedNotification({
    orderId: order.id,
    userName: order.user_name,
  })
}

/**
 * Verifica UNA orden: escalamiento por edad primero (siempre disponible, aun
 * sin credencial), después la consulta de depósito. Nunca lanza.
 */
async function verifyOrder(order: MpOrderRow): Promise<void> {
  const sinceMs = order.verifying_since
    ? Date.parse(order.verifying_since)
    : Date.now()
  const waitingMs = Date.now() - (Number.isNaN(sinceMs) ? Date.now() : sinceMs)

  if (waitingMs >= TRANSFER_DEPOSIT_ESCALATE_AFTER_MS) {
    const escalated = await markTransferDepositEscalated(order.id).catch(() => false)
    if (escalated) {
      logEvent("transfer_deposit.escalated", {
        order_id: order.id,
        user_name: order.user_name,
        amount: order.amount,
        checks: order.deposit_checks,
        waiting_ms: waitingMs,
      })
      notifyEscalated(order)
    }
    return
  }

  const accessToken = await resolveRenewalDepositToken(order)
  if (!accessToken) {
    // Sin credencial para la cuenta receptora no hay verificación posible:
    // reprogra para que el escalamiento por edad siga corriendo (jamás se
    // aprueba a ciegas).
    await saveTransferOrderDepositCheck({
      orderId: order.id,
      checks: order.deposit_checks + 1,
      nextCheckAt: new Date(Date.now() + TRANSFER_DEPOSIT_NO_CREDENTIAL_DELAY_MS),
    }).catch(() => {})
    return
  }

  let approved: MpOrderRow | null = null
  try {
    approved = await tryConfirmRenewalDeposit({ order, accessToken })
  } catch (error) {
    // Fallo de MP/BD: cuenta como intento fallido para el backoff (la edad
    // sigue mandando el escalamiento a 24 h) — una credencial roja o MP
    // caído no debe significar un sondeo por minuto durante todo el tope.
    logEvent("transfer_deposit.check_failed", {
      order_id: order.id,
      user_name: order.user_name,
      error: error instanceof Error ? error.message : String(error),
    })
    const checks = order.deposit_checks + 1
    await saveTransferOrderDepositCheck({
      orderId: order.id,
      checks,
      nextCheckAt: new Date(Date.now() + transferDepositNextDelayMs(checks)),
    }).catch(() => {})
    return
  }

  if (approved) {
    // La aprobación (approveTransferOrder) ya lanzó la renovación con su
    // bitácora y sus avisos de siempre: aquí solo queda la evidencia.
    logEvent("transfer_deposit.confirmed", {
      order_id: order.id,
      user_name: order.user_name,
      amount: order.amount,
      mp_payment_id: approved.mp_payment_id,
      source: "verificador",
      checks: order.deposit_checks,
      waiting_ms: waitingMs,
    })
    return
  }

  const checks = order.deposit_checks + 1
  await saveTransferOrderDepositCheck({
    orderId: order.id,
    checks,
    nextCheckAt: new Date(Date.now() + transferDepositNextDelayMs(checks)),
  }).catch(() => {})
  logEvent("transfer_deposit.check", {
    order_id: order.id,
    user_name: order.user_name,
    checks,
    waiting_ms: waitingMs,
  })
}

/** Pasada del verificador con concurrencia acotada. Nunca lanza. */
async function verifyTick(): Promise<void> {
  const due = await listDueVerifyingTransferOrders(MAX_PER_TICK).catch(() => [])
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
    await runTickPerTenant("flujo", async () => {
      await verifyTick()
    }, "mercadopago: renewal-deposit-verifier")
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `mercadopago: renewal-deposit-verifier: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  } finally {
    ticking = false
  }
}

/** Arranca el verificador una sola vez por proceso (idempotente). */
export function startRenewalDepositVerifier(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  // Node: el timer no debe mantener vivo el proceso por sí solo (builds,
  // scripts); en runtime el servidor pm2 ya lo mantiene arriba.
  const handle = timer as unknown as { unref?: () => void }
  handle.unref?.()
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "transfer_deposit.verifier_started",
      tick_ms: TICK_MS,
    })
  )
}
