import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { MercadoPagoError } from "@/server/mercadopago/errors"
import { createRenewalNotification } from "@/server/notifications/service"

/**
 * Saldo del panel (módulo «Abonar saldo», `/modulos/abonar-saldo`):
 *
 * - `applySaldoCredit` es el cumplimiento de una orden de abono cobrada
 *   (`mp_orders.months = 0`): acredita el monto en `users.saldo` y deja el
 *   movimiento trazado en `saldo_movimientos`. Es idempotente por diseño:
 *   la transacción reclama la orden hacia `applied` (claim atómico) y el
 *   índice único `saldo_movimientos.order_id` hace imposible acreditar la
 *   misma orden dos veces — reintentos del webhook, conciliación de `paid`
 *   varado, revisión admin y reintento de cupón re-ejecutan sin efecto.
 * - El abono de una orden con cupón es el único camino sincrónico (el canje
 *   ES el pago y la acreditación es local, sin llamadas al panel FlujoTV).
 * - `getSaldoSnapshot` alimenta la pantalla del módulo: saldo actual y
 *   últimos movimientos del comprador.
 */

export type SaldoApplyOutcome =
  | "applied"
  | "renewal_failed"
  | "already_processed"
  | "ignored"

export interface SaldoApplyResult {
  outcome: SaldoApplyOutcome
}

/**
 * Forma mínima de la orden que el abono necesita (evita el ciclo de tipos
 * con `mercadopago/service`). `user_name` de una orden de abono es el
 * username del comprador del panel.
 */
export interface SaldoOrderLike {
  id: string
  status: string
  user_name: string
  amount: number
  buyer_user_id: string | null
  error: string | null
}

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

function logError(context: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `saldo: ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
}

/**
 * Aplica el crédito de una orden de abono. Nunca lanza: el resultado queda
 * sellado en la orden (`applied` / `renewal_failed`) y el llamador solo
 * registra. Con la orden reclamada por otra transición (reembolso en curso)
 * devuelve `ignored` sin tocar nada.
 */
export async function applySaldoCredit(
  order: SaldoOrderLike,
  paymentId: string | null
): Promise<SaldoApplyResult> {
  try {
    if (order.buyer_user_id === null) {
      throw new MercadoPagoError(
        500,
        "saldo_sin_comprador",
        "La orden de abono no tiene comprador asociado."
      )
    }
    const amount = Math.round(order.amount * 100) / 100
    if (!(amount > 0)) {
      throw new MercadoPagoError(
        500,
        "saldo_monto_invalido",
        `La orden de abono ${order.id} tiene un monto no acreditable (${order.amount}).`
      )
    }

    const buyerUserId = order.buyer_user_id
    const client = await pool.connect()
    let claimApplied = false
    try {
      await client.query("BEGIN")
      // Serializa solo los abonos de un mismo comprador: el claim y la
      // actualización del saldo son atómicos frente a créditos concurrentes.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        buyerUserId,
      ])

      // Claim atómico: solo una ejecución mueve `paid`/`renewal_failed` →
      // `applied`. Reembolsos en curso (`refunding`) y ordenes ya aplicadas
      // no reclaman.
      const claim = await client.query(
        `UPDATE mp_orders
            SET status = 'applied', renewed_at = now(), error = NULL,
                payment_id = COALESCE($2::bigint, payment_id), updated_at = now()
          WHERE id = $1::uuid AND status IN ('paid', 'renewal_failed')`,
        [order.id, paymentId]
      )
      claimApplied = (claim.rowCount ?? 0) > 0

      if (claimApplied) {
        const updated = await client.query<{ saldo: string }>(
          `UPDATE users SET saldo = saldo + $2 WHERE id = $1::uuid RETURNING saldo`,
          [buyerUserId, amount]
        )
        const balanceAfter = Number(updated.rows[0]?.saldo ?? Number.NaN)
        if (!Number.isFinite(balanceAfter)) {
          throw new MercadoPagoError(
            500,
            "saldo_lectura_invalida",
            "La base no devolvió el saldo actualizado del comprador."
          )
        }
        // El índice único por orden es la segunda cerradura: aunque el claim
        // pasara dos veces (imposible), el movimiento solo entra una vez y
        // el conflicto deshace TODO el crédito. La cláusula debe repetir el
        // predicado del índice único parcial, o Postgres no la infiere.
        const movimiento = await client.query(
          `INSERT INTO saldo_movimientos
             (user_id, order_id, kind, amount, balance_after, note)
           VALUES ($1::uuid, $2::uuid, 'abono', $3, $4, 'Abono de saldo')
           ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
          [buyerUserId, order.id, amount, balanceAfter]
        )
        if ((movimiento.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK")
          claimApplied = false
          log("saldo.apply", {
            order_id: order.id,
            outcome: "already_processed",
            reason: "movement_exists",
          })
        } else {
          await client.query("COMMIT")
        }
      } else {
        await client.query("COMMIT")
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      throw error
    } finally {
      client.release()
    }

    if (!claimApplied) {
      // Otro intento ya aplicó el abono (o la orden pasó a reembolso):
      // clasificar sin tocar nada.
      const fresh = await pool.query<{ status: string }>(
        "SELECT status FROM mp_orders WHERE id = $1::uuid",
        [order.id]
      )
      const status = fresh.rows[0]?.status ?? ""
      return {
        outcome:
          status === "applied"
            ? "already_processed"
            : status === "refunding" || status === "refunded"
              ? "ignored"
              : "already_processed",
      }
    }

    publishRealtimeDetached({
      kind: "mp_order",
      entityId: order.id,
      userName: order.user_name,
      status: "applied",
    })
    // Aviso persistente al comprador: el abono quedó en su saldo.
    createRenewalNotification({
      buyerUserId,
      kind: "renewal_success",
      userName: order.user_name,
      months: 0,
      amountMxn: amount,
      orderId: order.id,
    })
    log("saldo.apply", {
      order_id: order.id,
      payment_id: paymentId,
      user_name: order.user_name,
      amount,
      outcome: "applied",
    })
    return { outcome: "applied" }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Acreditación de abono fallida."
    // Marcar el fallo es mejor esfuerzo: si la orden quedó en `paid`, la
    // conciliación (10 min) y el reintento la recuperan; el claim evita
    // pisar un reembolso reclamado en paralelo.
    await pool
      .query(
        `UPDATE mp_orders
            SET status = 'renewal_failed', error = $2, updated_at = now()
          WHERE id = $1::uuid AND status IN ('paid', 'renewal_failed')`,
        [order.id, message.slice(0, 500)]
      )
      .catch((updateError: unknown) => logError("mark_failed", updateError))
    if (order.buyer_user_id !== null) {
      createRenewalNotification({
        buyerUserId: order.buyer_user_id,
        kind: "renewal_failed",
        userName: order.user_name,
        months: 0,
        amountMxn: Math.round(order.amount * 100) / 100,
        // Sin el detalle técnico (errores de BD o de Mercado Pago llegan en
        // inglés): el comprador recibe el texto genérico del aviso y el
        // motivo real queda en `mp_orders.error` para el administrador.
        error: null,
        orderId: order.id,
      })
    }
    publishRealtimeDetached({
      kind: "mp_order",
      entityId: order.id,
      userName: order.user_name,
      status: "renewal_failed",
    })
    logError(`apply_${order.id}`, error)
    return { outcome: "renewal_failed" }
  }
}

/* -------------------------------------------------------------------------- */
/*                        Lectura del saldo para la UI                         */
/* -------------------------------------------------------------------------- */

export interface SaldoMovimientoPublic {
  id: string
  kind: string
  amount: number
  balance_after: number
  order_id: string | null
  note: string | null
  created_at: string
}

export interface SaldoSnapshot {
  /** Saldo disponible actual de la cuenta (MXN). */
  saldo: number
  /** Últimos movimientos, el más nuevo primero. */
  movimientos: SaldoMovimientoPublic[]
}

/** Tope de movimientos devueltos por la pantalla del módulo. */
const MOVIMIENTOS_LIMIT = 15

/**
 * Saldo y últimos movimientos del comprador. Los decimales llegan como
 * string desde numeric y se normalizan a número para la UI.
 */
export async function getSaldoSnapshot(
  userId: string,
  limit: number = MOVIMIENTOS_LIMIT
): Promise<SaldoSnapshot> {
  const [saldoResult, movimientosResult] = await Promise.all([
    pool.query<{ saldo: string }>(
      "SELECT saldo FROM users WHERE id = $1::uuid",
      [userId]
    ),
    pool.query<Record<string, unknown>>(
      `SELECT id, kind, amount, balance_after, order_id, note, created_at
         FROM saldo_movimientos
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit]
    ),
  ])

  const movimientos: SaldoMovimientoPublic[] = movimientosResult.rows.map(
    (row) => ({
      id: String(row.id),
      kind: String(row.kind),
      amount: Number(row.amount),
      balance_after: Number(row.balance_after),
      order_id: row.order_id === null || row.order_id === undefined
        ? null
        : String(row.order_id),
      note: row.note === null || row.note === undefined ? null : String(row.note),
      created_at: new Date(row.created_at as string).toISOString(),
    })
  )

  return {
    saldo: Number(saldoResult.rows[0]?.saldo ?? 0),
    movimientos,
  }
}
