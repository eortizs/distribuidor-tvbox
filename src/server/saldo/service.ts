import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { MercadoPagoError } from "@/server/mercadopago/errors"
import { createRenewalNotification } from "@/server/notifications/service"
import { parseSaldoTipo, SALDO_TIPO_COLUMN, type SaldoTipo } from "@/lib/saldo"

/**
 * Saldo del panel (módulo «Abonar saldo», `/modulos/abonar-saldo`):
 *
 * - `applySaldoCredit` es el cumplimiento de una orden de abono cobrada
 *   (`mp_orders.months = 0`): acredita el monto en la billetera que la orden
 *   definió (`mp_orders.saldo_tipo`: tokens o cupones; NULL legado →
 *   cupones) y deja el movimiento trazado en `saldo_movimientos`. Es
 *   idempotente por diseño: la transacción reclama la orden hacia `applied`
 *   (claim atómico) y el índice único `saldo_movimientos.order_id` hace
 *   imposible acreditar la misma orden dos veces — reintentos del webhook,
 *   conciliación de `paid` varado, revisión admin y reintento de cupón
 *   re-ejecutan sin efecto.
 * - El abono de una orden con cupón es el único camino sincrónico (el canje
 *   ES el pago y la acreditación es local, sin llamadas al panel FlujoTV).
 * - `getSaldoSnapshot` alimenta la pantalla del módulo: saldo en tokens y en
 *   cupones, y últimos movimientos del comprador.
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
  /**
   * Tipo de saldo que la orden acredita (`mp_orders.saldo_tipo`): tokens o
   * cupones; NULL en órdenes legadas y se interpreta como cupones.
   */
  saldo_tipo: string | null
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
    // NULL legado (o renovación mal clasificada) → cupones: el saldo que
    // existía antes de los tipos era para licencias.
    const saldoTipo: SaldoTipo =
      parseSaldoTipo(order.saldo_tipo) ?? "cupones"
    const balanceColumn = SALDO_TIPO_COLUMN[saldoTipo]
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
          `UPDATE users SET ${balanceColumn} = ${balanceColumn} + $2 WHERE id = $1::uuid RETURNING ${balanceColumn} AS saldo`,
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
              (user_id, order_id, kind, tipo, amount, balance_after, note)
            VALUES ($1::uuid, $2::uuid, 'abono', $5, $3, $4, $6)
            ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
          [
            buyerUserId,
            order.id,
            amount,
            balanceAfter,
            saldoTipo,
            saldoTipo === "tokens"
              ? "Abono de saldo en tokens"
              : "Abono de saldo en cupones",
          ]
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
      saldoTipo,
      orderId: order.id,
    })
    log("saldo.apply", {
      order_id: order.id,
      payment_id: paymentId,
      user_name: order.user_name,
      amount,
      saldo_tipo: saldoTipo,
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
        saldoTipo: parseSaldoTipo(order.saldo_tipo) ?? "cupones",
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
/*                     Ajuste manual del admin (sin checkout)                  */
/* -------------------------------------------------------------------------- */

export interface AjusteSaldoResult {
  /** Saldo de la billetera ajustada después del movimiento. */
  balance: number
}

/**
 * Abono directo de saldo a la cuenta de un usuario, ejecutado por un admin
 * desde `/users` sin pasar por el checkout de pagos. Transacción atómica con
 * el mismo advisory lock por comprador que `applySaldoCredit`: dos ajustes
 * concurrentes (o un ajuste contra un abono de orden) no se pisan. El
 * movimiento queda trazado con `kind = 'ajuste'`, la billetera (`tipo`) y el
 * admin responsable (`created_by`); sin `order_id`, el índice único de
 * idempotencia de abonos no aplica (cada ajuste es un movimiento nuevo).
 */
export async function ajustarSaldoAdmin(params: {
  /** Cuenta del usuario que recibe el abono. */
  targetUserId: string
  /** Billetera destino: tokens o cupones. */
  tipo: SaldoTipo
  /** Monto a acreditar en MXN, ya validado (> 0). */
  amount: number
  /** Admin responsable (para la auditoría del movimiento). */
  adminUserId: string
}): Promise<AjusteSaldoResult> {
  const amount = Math.round(params.amount * 100) / 100
  if (!(amount > 0)) {
    throw new Error("El monto del abono debe ser mayor a $0.")
  }
  const balanceColumn = SALDO_TIPO_COLUMN[params.tipo]
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    // Serializa los ajustes y créditos de la misma cuenta: la lectura del
    // balance_after siempre es la vigente.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      params.targetUserId,
    ])
    const updated = await client.query<{ saldo: string }>(
      `UPDATE users SET ${balanceColumn} = ${balanceColumn} + $2 WHERE id = $1::uuid RETURNING ${balanceColumn} AS saldo`,
      [params.targetUserId, amount]
    )
    if ((updated.rowCount ?? 0) === 0) {
      throw new Error("La cuenta del usuario no existe.")
    }
    const balanceAfter = Number(updated.rows[0]?.saldo ?? Number.NaN)
    if (!Number.isFinite(balanceAfter)) {
      throw new Error("La base no devolvió el saldo actualizado del usuario.")
    }
    await client.query(
      `INSERT INTO saldo_movimientos
          (user_id, order_id, kind, tipo, amount, balance_after, note, created_by)
        VALUES ($1::uuid, NULL, 'ajuste', $2, $3, $4, $5, $6::uuid)`,
      [
        params.targetUserId,
        params.tipo,
        amount,
        balanceAfter,
        params.tipo === "tokens"
          ? "Abono directo de saldo en tokens (admin)"
          : "Abono directo de saldo en cupones (admin)",
        params.adminUserId,
      ]
    )
    await client.query("COMMIT")
    return { balance: balanceAfter }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/* -------------------------------------------------------------------------- */
/*                        Lectura del saldo para la UI                         */
/* -------------------------------------------------------------------------- */

export interface SaldoMovimientoPublic {
  id: string
  kind: string
  /** Billetera del movimiento: tokens o cupones. */
  tipo: SaldoTipo
  amount: number
  balance_after: number
  order_id: string | null
  note: string | null
  created_at: string
}

export interface SaldoSnapshot {
  /** Saldo en cupones disponible (MXN): compra de licencias de FlujoTV. */
  cupones: number
  /** Saldo en tokens disponible (MXN): herramientas con APIs externas. */
  tokens: number
  /** Últimos movimientos, el más nuevo primero (ambas billeteras). */
  movimientos: SaldoMovimientoPublic[]
}

/** Tope de movimientos devueltos por la pantalla del módulo. */
const MOVIMIENTOS_LIMIT = 15

export interface SaldosActual {
  cupones: number
  tokens: number
}

/**
 * Saldos disponibles del comprador en una lectura ligera (una fila por PK):
 * alimenta el chip de la cabecera sin arrastrar movimientos.
 */
export async function getSaldosActual(userId: string): Promise<SaldosActual> {
  const result = await pool.query<{
    saldo_cupones: string
    saldo_tokens: string
  }>("SELECT saldo_cupones, saldo_tokens FROM users WHERE id = $1::uuid", [
    userId,
  ])
  const row = result.rows[0]
  return {
    cupones: Number(row?.saldo_cupones ?? 0),
    tokens: Number(row?.saldo_tokens ?? 0),
  }
}

/**
 * Saldos y últimos movimientos del comprador. Los decimales llegan como
 * string desde numeric y se normalizan a número para la UI.
 */
export async function getSaldoSnapshot(
  userId: string,
  limit: number = MOVIMIENTOS_LIMIT
): Promise<SaldoSnapshot> {
  const [saldos, movimientosResult] = await Promise.all([
    getSaldosActual(userId),
    pool.query<Record<string, unknown>>(
      `SELECT id, kind, tipo, amount, balance_after, order_id, note, created_at
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
      tipo: parseSaldoTipo(row.tipo) ?? "cupones",
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
    cupones: saldos.cupones,
    tokens: saldos.tokens,
    movimientos,
  }
}
