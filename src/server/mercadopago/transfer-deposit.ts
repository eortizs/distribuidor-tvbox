import { findReservedMpPaymentIds } from "@/server/ligas-pago/repository"
import { MercadoPagoError } from "./errors"
import {
  approveTransferOrder,
  ORDER_ORIGIN_WA_CLIENTE,
  type MpOrderRow,
} from "./service"
import { findDepositsForPaymentOrderWindow } from "./spei"
import { markUserMpTokenInvalid, resolveSellerMpAccessToken } from "./tokens"

/*
 * Casado orden de renovación ↔ depósito acreditado en Mercado Pago, espejo
 * del de las ligas de pago (`src/server/ligas-pago/deposit-check.ts`): el
 * comprobante ya validó el escaneo (concepto, importe, beneficiario) y el
 * DEPÓSITO acreditado prueba que el dinero llegó a la cuenta del vendedor.
 * MP no expone el concepto escrito por el pagador, así que el casado es por
 * IMPORTE EXACTO (a centavos) + VENTANA [created_at − 2 min, ahora], con el
 * ID del pago reservado en exclusiva (índice único parcial + filtro CRUZADO
 * contra las reservas de las ligas de pago: ambos flujos leen la misma
 * cuenta cuando el vendedor es el admin).
 *
 * TOKEN por orden: `origin='wa_cliente'` → el dinero va a la cuenta del
 * DISTRIBUIDOR (buyer de la orden) → su credencial propia; cualquier otro
 * flujo (sheet, asistente, cliente del admin) → cuenta del `.env` → token de
 * plataforma. Null = cuenta sin credencial consultable: el llamador conserva
 * el comportamiento sin verificación (auto-aprobación al validar el
 * comprobante), jamás bloquea la renovación.
 */

/** Slack de la ventana por si el depósito se acredita antes del movedor. */
const WINDOW_SLACK_MS = 2 * 60_000

function amountsEqualCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

/** Vendedor que RECIBE el dinero de la orden (para elegir el token). */
function renewalSellerUserId(order: MpOrderRow): string | null {
  return order.origin === ORDER_ORIGIN_WA_CLIENTE ? order.buyer_user_id : null
}

/**
 * Token que consulta la cuenta RECEPTORA del dinero para un vendedor dado:
 * distribuidor (credencial propia) o null → plataforma (`.env`). Null si no
 * hay credencial que la vea.
 */
export async function resolveRenewalDepositTokenForSeller(
  sellerUserId: string | null
): Promise<string | null> {
  return resolveSellerMpAccessToken(sellerUserId).catch(() => null)
}

/**
 * Token que consulta la cuenta RECEPTORA del dinero de esta orden; null si
 * no hay credencial que la vea (distribuidor sin token propio, plataforma
 * sin `MERCADOPAGO_ACCESS_TOKEN`).
 */
export async function resolveRenewalDepositToken(
  order: MpOrderRow
): Promise<string | null> {
  return resolveRenewalDepositTokenForSeller(renewalSellerUserId(order))
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

/**
 * Busca el depósito de la orden y lo reclama: consulta MP en la ventana de
 * la orden con el token dado, filtra importe exacto (a centavos), descarta
 * IDs ya reservados por OTRAS órdenes de cualquier flujo y reclama el más
 * antiguo (FIFO). Reclamar = `approveTransferOrder` desde 'verifying': la
 * orden queda `paid` con el ID del pago reservado y la renovación se lanza
 * con la clave determinista de siempre. Devuelve la orden ya aprobada, o
 * null si aún no hay depósito (o el claim lo ganó otro actor).
 * Un 401/403 marca el token propio inválido (el perfil pide re-registrarlo).
 */
export async function tryConfirmRenewalDeposit(input: {
  order: MpOrderRow
  accessToken: string
  /** Presupuesto de la consulta MP (default: el del verificador). */
  budgetMs?: number
  /** Timeout por página propio (el chequeo inmediato usa uno corto). */
  pageTimeoutMs?: number
}): Promise<MpOrderRow | null> {
  const createdMs = Date.parse(input.order.created_at)
  const beginIso = new Date(
    (Number.isNaN(createdMs) ? Date.now() : createdMs) - WINDOW_SLACK_MS
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
      const seller = renewalSellerUserId(input.order)
      if (seller) await markUserMpTokenInvalid(seller)
    }
    throw error
  }

  const candidates = deposits
    .filter((deposit) => deposit.id.length > 0)
    .filter((deposit) => amountsEqualCents(deposit.amountMxn, input.order.amount))
    .sort((a, b) => {
      const aMs = a.dateApproved ? Date.parse(a.dateApproved) : Number.POSITIVE_INFINITY
      const bMs = b.dateApproved ? Date.parse(b.dateApproved) : Number.POSITIVE_INFINITY
      return aMs - bMs
    })
  if (candidates.length === 0) return null

  // Reserva CRUZADA: si el fallo de BD impide saber qué depósitos están
  // libres, se asume el peor caso (todos reservados) y el siguiente sondeo
  // reintenta — jamás se confirma con un depósito que pudo validar otra
  // orden (ligas de pago comparten la misma cuenta).
  const reserved = await findReservedMpPaymentIds(
    candidates.map((deposit) => deposit.id)
  ).catch(() => new Set<string>(candidates.map((deposit) => deposit.id)))
  const free = candidates.filter((deposit) => !reserved.has(deposit.id))
  if (free.length === 0) return null

  const chosen = free[0]
  try {
    return await approveTransferOrder(input.order.id, {
      mpPaymentId: Number(chosen.id),
      mpDepositAt: chosen.dateApproved,
    })
  } catch (error) {
    // Carrera: el verificador de ligas de pago (u otro actor) reclamó el
    // mismo depósito o resolvió la orden entre la lectura y el claim. El
    // advisory lock del claim convierte el conflicto cruzado en
    // `deposit_claim_lost`; la unique residual (23505) mapea igual — en
    // ambos casos el siguiente sondeo reintenta con otro depósito.
    const claimPerdido =
      (error instanceof MercadoPagoError &&
        (error.code === "order_already_processed" ||
          error.code === "invalid_order_status" ||
          error.code === "deposit_claim_lost")) ||
      (typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "23505")
    if (claimPerdido) {
      logEvent("transfer_deposit.claim_lost", {
        order_id: input.order.id,
        mp_payment_id: chosen.id,
      })
      return null
    }
    throw error
  }
}
