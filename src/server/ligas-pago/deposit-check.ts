import { findDepositsForPaymentOrderWindow } from "@/server/mercadopago/spei"

import {
  confirmPaymentOrderDeposit,
  findPaymentOrdersByMpPaymentIds,
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
 * aprobarse con el mismo pago.
 *
 * ALCANCE: solo órdenes de creadores ADMIN (gate en review.ts +
 * listDueVerifyingOrders) — el pagador de una orden de distribuidor paga a
 * la CLABE del snapshot del creador, una cuenta que el token de la
 * plataforma no ve; su verificación es manual por diseño.
 *
 * Es la pieza compartida del chequeo INMEDIATO (al aprobarse el comprobante,
 * dentro del turno de WhatsApp) y del VERIFICADOR en background
 * (deposit-verifier.ts): ambos llaman a `tryConfirmOrderDeposit`.
 */

/** Slack de la ventana por si el depósito se acredita antes del movedor. */
const WINDOW_SLACK_MS = 2 * 60_000

function amountsEqualCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * Busca el depósito de la orden y lo reclama: consulta MP en la ventana de
 * la orden, filtra importe exacto (a centavos), descarta IDs ya reservados
 * por OTRAS órdenes (el índice único es la última guarda; este filtro evita
 * intentos inútiles) y reclama el más antiguo (`FIFO`: si el pagador pagó
 * dos veces, cualquiera de los dos depósitos valida). Devuelve la orden ya
 * `paid`, o null si aún no hay depósito, el claim se perfeccionó para otro
 * actor o la orden dejó de estar en verificación.
 */
export async function tryConfirmOrderDeposit(input: {
  order: PaymentOrder
  /** Presupuesto de la consulta MP (default: el del verificador). */
  budgetMs?: number
  /** Timeout por página propio (el chequeo inmediato usa uno corto). */
  pageTimeoutMs?: number
}): Promise<PaymentOrder | null> {
  const createdMs = Date.parse(input.order.createdAt)
  const beginIso = new Date(
    (Number.isNaN(createdMs) ? Date.now() : createdMs) - WINDOW_SLACK_MS
  ).toISOString()
  const endIso = new Date().toISOString()

  const deposits = await findDepositsForPaymentOrderWindow({
    beginIso,
    endIso,
    budgetMs: input.budgetMs,
    pageTimeoutMs: input.pageTimeoutMs,
  })

  const candidates = deposits
    .filter((deposit) => deposit.id.length > 0)
    .filter((deposit) => amountsEqualCents(deposit.amountMxn, input.order.amountMxn))
    .sort((a, b) => {
      const aMs = a.dateApproved ? Date.parse(a.dateApproved) : Number.POSITIVE_INFINITY
      const bMs = b.dateApproved ? Date.parse(b.dateApproved) : Number.POSITIVE_INFINITY
      return aMs - bMs
    })
  if (candidates.length === 0) return null

  const reserved = await findPaymentOrdersByMpPaymentIds(
    candidates.map((deposit) => deposit.id)
  ).catch(() => new Map<string, string>())
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
