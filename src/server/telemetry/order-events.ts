import { randomBytes } from "node:crypto"

import { pool } from "@/server/db"

/**
 * Servicio interno de trazas de transacción para las renovaciones de
 * licencias (`mp_orders`).
 *
 * Cada intento de renovación —webhook de Mercado Pago, canje de cupón,
 * scheduler, conciliación o reintento del admin— corre bajo un
 * `transaction_id` propio y deja eventos en la tabla `mp_order_events`
 * (migración `db/apply-order-events.mjs`). El log JSON de consola lleva el
 * mismo id, así que una línea de pm2 y su bitácora en BD se corresponden:
 *
 *   # por orden:  SELECT * FROM mp_order_events WHERE order_id = '…' ORDER BY id;
 *   # por traza:  SELECT * FROM mp_order_events WHERE transaction_id = 'txn-…';
 *
 * Reglas del servicio:
 * - Best-effort: un fallo de bitácora NUNCA rompe la renovación (se reporta
 *   en consola y sigue). La renovación ya es crítica; la bitácora no puede
 *   amplificarla.
 * - Detached por defecto (`recordOrderEventDetached`): nunca aporta latencia
 *   al camino de la compra.
 * - Datos acotados: mensajes recortados y sin secretos; `detail` es jsonb.
 */

/** Identificador de transacción: `txn-` + 12 hex (48 bits, único por intento). */
export function newTransactionId(): string {
  return `txn-${randomBytes(6).toString("hex")}`
}

export interface OrderEventInput {
  /** Orden a la que pertenece el evento (correlación de negocio). */
  orderId: string
  /** Transacción (intento concreto) que produjo el evento. */
  transactionId: string
  /** Nombre del evento del ciclo de vida (p. ej. `renewal_retry_scheduled`). */
  event: string
  /** Resultado del intento cuando aplica (p. ej. `retry_scheduled`). */
  outcome?: string | null
  /** Número de intento cuando aplica (reintentos agendados, key_attempts). */
  attempt?: number | null
  /** Datos extra acotados (mensajes recortados, ids, cifras). */
  detail?: Record<string, unknown>
}

/** Recorta textos de `detail` para que una traza no crezca sin control. */
function compactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "string") {
      out[key] = value.slice(0, 300)
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value
    } else {
      out[key] = String(value).slice(0, 300)
    }
  }
  return out
}

/**
 * Persiste un evento del ciclo de vida de una orden en `mp_order_events`.
 * Nunca lanza: un fallo de bitácora se reporta en consola y sigue.
 */
export async function recordOrderEvent(input: OrderEventInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO mp_order_events
         (order_id, transaction_id, event, outcome, attempt, detail)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.orderId,
        input.transactionId,
        input.event,
        input.outcome ?? null,
        input.attempt ?? null,
        input.detail === undefined ? null : JSON.stringify(compactDetail(input.detail)),
      ]
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `telemetry: record_order_event: ${
          error instanceof Error ? error.message : String(error)
        }`,
        event: input.event,
        order_id: input.orderId,
        transaction_id: input.transactionId,
      })
    )
  }
}

/** Variante desacoplada: no aporta latencia al camino de la compra. */
export function recordOrderEventDetached(input: OrderEventInput): void {
  void recordOrderEvent(input)
}

export interface OrderEventRow {
  id: string
  order_id: string
  transaction_id: string
  event: string
  outcome: string | null
  attempt: number | null
  detail: unknown
  created_at: string
}

function parseEventRow(row: Record<string, unknown>): OrderEventRow {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    transaction_id: String(row.transaction_id),
    event: String(row.event),
    outcome: row.outcome === null || row.outcome === undefined ? null : String(row.outcome),
    attempt:
      typeof row.attempt === "number" && Number.isInteger(row.attempt)
        ? row.attempt
        : null,
    detail: row.detail ?? null,
    created_at: new Date(row.created_at as string).toISOString(),
  }
}

/**
 * Bitácora de una orden, del más viejo al más nuevo: la secuencia de eventos
 * reconstruye la transacción completa (soporte y monitoreo de fallos).
 */
export async function listOrderEvents(
  orderId: string,
  limit = 100
): Promise<OrderEventRow[]> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM mp_order_events
      WHERE order_id = $1::uuid
      ORDER BY id ASC
      LIMIT $2`,
    [orderId, limit]
  )
  return result.rows.map(parseEventRow)
}
