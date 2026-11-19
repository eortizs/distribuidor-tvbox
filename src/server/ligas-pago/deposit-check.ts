import { findDepositsForPaymentOrderWindow } from "@/server/mercadopago/spei"
import { markUserMpTokenInvalid } from "@/server/mercadopago/tokens"
import { MercadoPagoError } from "@/server/mercadopago/errors"
import {
  amountsEqualCents,
  depositWithinOrderWindow,
  PAYMENT_ORDER_DEPOSIT_SLACK_MS,
} from "@/lib/ligas-pago"

import {
  findReservedMpPaymentIds,
  confirmPaymentOrderDeposit,
  listPlatformDepositClaimantPaymentOrders,
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
 * (`findReservedMpPaymentIds`): ligas de pago y renovaciones comparten la
 * misma cuenta MP y el mismo feed de depósitos.
 *
 * Dos LLAMADORES por orden:
 *   - `tryConfirmOrderDeposit` (order-side): busca el depósito de UNA orden
 *     en su ventana. Es la pieza del chequeo INMEDIATO tras el comprobante
 *     (dentro del turno de WhatsApp), del VERIFICADOR en background para
 *     órdenes 'verifying' (deposit-verifier.ts) y del CARRIL PENDING: con
 *     `uniqueOnly` el claim exige COINCIDENCIA ÚNICA dentro del candado —
 *     sin comprobante NO hay código impreso que desambigue, así que dos
 *     órdenes activas del mismo importe jamás se auto-confirman (ver
 *     `confirmPaymentOrderDeposit`).
 *   - `tryConfirmDepositPayment` (deposit-side): UN depósito (rama webhook,
 *     hoy inerte — MP no emite notificaciones por depósitos; blindaje por si
 *     empieza a emitirlas) busca su ÚNICA orden reclamante.
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
 *
 * `uniqueOnly` (carril pending sin comprobante): el claim exige dentro del
 * candado que NINGUNA otra orden activa (payment_orders o mp_orders
 * verifying) del mismo importe cubra el depósito — ver
 * `confirmPaymentOrderDeposit`. Las dos órdenes del mismo importe quedan
 * para el comprobante o el creador: sin código impreso no hay
 * desambiguación posible.
 */
export async function tryConfirmOrderDeposit(input: {
  order: PaymentOrder
  /** Presupuesto de la consulta MP (default: el del verificador). */
  budgetMs?: number
  /** Timeout por página propio (el chequeo inmediato usa uno corto). */
  pageTimeoutMs?: number
  /** Token de la cuenta receptora (credencial propia o plataforma). */
  accessToken: string
  /** Exige coincidencia única en el claim (carril pending sin comprobante). */
  uniqueOnly?: boolean
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
    uniqueOnly: input.uniqueOnly,
  })
}

/**
 * Match DEPOSIT-SIDE para la rama webhook: UN pago de MP ya clasificado como
 * depósito acreditado (`isDepositLikePayment`) busca su ÚNICA orden
 * reclamante. El pago se leyó con el token de PLATAFORMA, así que las
 * candidatas se acotan a órdenes cuyo dinero apunta a ESA cuenta
 * (`listPlatformDepositClaimantPaymentOrders`); la ventana y el importe se
 * filtran aquí (predicados puros compartidos) y la autoridad final es la
 * guarda de unicidad DENTRO del candado del claim (`uniqueOnly`). Null =
 * sin candidata única, depósito ya reservado o claim perdido — el flujo de
 * siempre (verificador por orden, comprobante, creador) sigue siendo el
 * dueño del resultado.
 *
 * Hoy MP no emite notificaciones por depósitos (verificado en producción:
 * 26 días de logs con depósitos confirmados y cero eventos); la función
 * queda como blindaje para el día en que MP empiece a emitirlas.
 */
export async function tryConfirmDepositPayment(input: {
  mpPaymentId: string
  amountMxn: number
  dateApproved: string | null
}): Promise<PaymentOrder | null> {
  const depositAtMs = input.dateApproved ? Date.parse(input.dateApproved) : null
  if (!Number.isFinite(input.amountMxn) || depositAtMs === null) return null

  const candidates = await listPlatformDepositClaimantPaymentOrders(
    input.amountMxn
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

  const order = inWindow[0]
  return confirmPaymentOrderDeposit({
    orderId: order.id,
    mpPaymentId: input.mpPaymentId,
    mpDepositAt: input.dateApproved,
    reviewedBy: order.creatorUserId,
    uniqueOnly: true,
  })
}
