import { findDepositsForPaymentOrderWindow } from "@/server/mercadopago/spei"
import { markUserMpTokenInvalid } from "@/server/mercadopago/tokens"
import { MercadoPagoError } from "@/server/mercadopago/errors"
import {
  amountsEqualCents,
  depositWithinOrderWindow,
  PAYMENT_ORDER_DEPOSIT_SLACK_MS,
} from "@/lib/links-pago"

import {
  findReservedMpPaymentIds,
  confirmPaymentOrderDeposit,
  listDepositClaimantPaymentOrders,
  type PaymentOrder,
} from "./repository"

/*
 * Casado orden ↔ depósito acreditado en Mercado Pago (misma fuente que el
 * reporte SPEI, ambos rieles: SPEI a la CLABE `account_fund` + transferencia
 * desde el saldo de otra cuenta MP `money_transfer`).
 *
 * MP NO expone el concepto escrito por el pagador (verificado en el payload
 * crudo), así que el depósito se casa por IMPORTE EXACTO + VENTANA
 * [created_at − 2 min, ahora]: el código impreso que el escaneo ya validó en
 * el comprobante es la prueba que liga al pagador con la orden; el depósito
 * prueba que el dinero llegó. El ID del pago de MP queda RESERVADO en
 * exclusiva por orden (índice único parcial sobre mp_payment_id): un
 * depósito solo valida una orden y dos verificaciones concurrentes no pueden
 * aprobarse con el mismo pago. La reserva es CRUZADA entre flujos
 * (`findReservedMpPaymentIds`): links de pago y renovaciones comparten la
 * misma cuenta MP y el mismo feed de depósitos.
 *
 * Dos LLAMADORES por orden:
 *   - `tryConfirmOrderDeposit` (order-side): busca el depósito de UNA orden
 *     'verifying' (comprobante ya validado con su código impreso — la
 *     identificación del pagador por código es MANDATORIA) en su ventana.
 *     Es la pieza del chequeo INMEDIATO tras el comprobante (dentro del
 *     turno de WhatsApp) y del VERIFICADOR en background
 *     (deposit-verifier.ts). No hay carril sin comprobante: una orden
 *     'pending' jamás se autoconfirma por depósito.
 *   - `tryConfirmDepositPayment` (deposit-side): UN depósito (rama webhook,
 *     hoy inerte — MP no emite notificaciones por depósitos; blindaje por si
 *     empieza a emitirlas) busca su ÚNICA orden 'verifying' reclamante.
 *
 * El TOKEN de consulta lo resuelve el llamador
 * (`resolvePaymentOrderDepositToken`): credencial propia del creador o la de
 * plataforma para el admin. Con 401 el token propio se marca inválido (el
 * perfil pide re-registrarlo) y el verificador degrada al escalamiento por
 * edad; jamás se auto-aprueba sin depósito visible.
 */

/**
 * Busca el depósito de la orden y lo reclama: consulta MP en la ventana de
 * la orden, filtra importe exacto (a centavos), descarta IDs ya reservados
 * por OTRAS órdenes de CUALQUIER flujo (el índice único es la última guarda;
 * este filtro evita intentos inútiles) y reclama el más antiguo (`FIFO`: si
 * el pagador pagó dos veces, cualquiera de los dos depósitos valida).
 * Devuelve la orden ya `paid`, o null si aún no hay depósito, el claim se
 * perfeccionó para otro actor o la orden dejó de ser reclamante.
 */
export async function tryConfirmOrderDeposit(input: {
  order: PaymentOrder
  /** Presupuesto de la consulta MP (default: el del verificador). */
  budgetMs?: number
  /** Timeout por página propio (el chequeo inmediato usa uno corto). */
  pageTimeoutMs?: number
  /** Token de la cuenta receptora (credencial propia o plataforma). */
  accessToken: string
}): Promise<PaymentOrder | null> {
  const createdMs = Date.parse(input.order.createdAt)
  const beginIso = new Date(
    (Number.isNaN(createdMs) ? Date.now() : createdMs) -
      PAYMENT_ORDER_DEPOSIT_SLACK_MS
  ).toISOString()
  const endIso = new Date().toISOString()

  let deposits: Awaited<ReturnType<typeof findDepositsForPaymentOrderWindow>>
  try {
    deposits = await findDepositsForPaymentOrderWindow({
      beginIso,
      endIso,
      budgetMs: input.budgetMs,
      pageTimeoutMs: input.pageTimeoutMs,
      accessToken: input.accessToken,
    })
  } catch (error) {
    if (
      error instanceof MercadoPagoError &&
      (error.status === 401 || error.status === 403)
    ) {
      await markUserMpTokenInvalid(input.order.creatorUserId)
    }
    throw error
  }

  const candidates = deposits
    .filter((deposit) => deposit.id.length > 0)
    .filter((deposit) => amountsEqualCents(deposit.amountMxn, input.order.amountMxn))
    .sort((a, b) => {
      const aMs = a.dateApproved ? Date.parse(a.dateApproved) : Number.POSITIVE_INFINITY
      const bMs = b.dateApproved ? Date.parse(b.dateApproved) : Number.POSITIVE_INFINITY
      return aMs - bMs
    })
  if (candidates.length === 0) return null

  const reserved = await findReservedMpPaymentIds(
    candidates.map((deposit) => deposit.id)
  ).catch(() => new Set<string>(candidates.map((deposit) => deposit.id)))
  const free = candidates.filter((deposit) => !reserved.has(deposit.id))
  if (free.length === 0) return null

  const chosen = free[0]
  return confirmPaymentOrderDeposit({
    orderId: input.order.id,
    mpPaymentId: chosen.id,
    mpDepositAt: chosen.dateApproved,
    reviewedBy: input.order.creatorUserId,
  })
}

/**
 * Match DEPOSIT-SIDE: UN depósito de MP ya acreditado busca su ÚNICA orden
 * 'verifying' reclamante (comprobante ya validado con el código impreso —
 * sin comprobante no hay confirmación). Lo comparten el BARRIDO del
 * verificador (una búsqueda por cuenta cubre todas sus órdenes — reacción
 * en la fase del tick) y la rama webhook (hoy inerte: MP no emite
 * notificaciones por depósitos, 26 días de logs con cero eventos; blindaje
 * por si empieza a emitirlas). El `sellerUserId` acota las candidatas a
 * órdenes cuyo dinero apunta a la MISMA cuenta que leyó el depósito (`null`
 * = plataforma: admins sin token propio); la ventana se filtra con el
 * predicado puro compartido y la reserva del depósito es la guarda final
 * dentro del candado del claim. Null = sin candidata única, depósito ya
 * reservado o claim perdido.
 */
export async function tryConfirmDepositPayment(input: {
  mpPaymentId: string
  amountMxn: number
  dateApproved: string | null
  /** Cuenta receptora del depósito: null = plataforma (.env). */
  sellerUserId?: string | null
}): Promise<PaymentOrder | null> {
  const depositAtMs = input.dateApproved ? Date.parse(input.dateApproved) : null
  if (!Number.isFinite(input.amountMxn) || depositAtMs === null) return null

  const candidates = await listDepositClaimantPaymentOrders(
    input.amountMxn,
    input.sellerUserId ?? null
  ).catch(() => [] as PaymentOrder[])
  const inWindow = candidates.filter(
    (order) =>
      amountsEqualCents(order.amountMxn, input.amountMxn) &&
      depositWithinOrderWindow({
        orderCreatedAtMs: Date.parse(order.createdAt),
        depositAtMs,
      })
  )
  if (inWindow.length !== 1) return null

  const reserved = await findReservedMpPaymentIds([input.mpPaymentId]).catch(
    () => new Set([input.mpPaymentId])
  )
  if (reserved.has(input.mpPaymentId)) return null

  return confirmPaymentOrderDeposit({
    orderId: inWindow[0].id,
    mpPaymentId: input.mpPaymentId,
    mpDepositAt: input.dateApproved,
    reviewedBy: inWindow[0].creatorUserId,
  })
}
