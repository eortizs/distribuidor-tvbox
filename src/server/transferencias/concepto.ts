import { randomInt } from "node:crypto"

import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Concepto de pago de las transferencias bancarias: código de 4 caracteres
 * alfanuméricos entregado al comprador ANTES de pagar, ligado a su cuenta y
 * al usuario de FlujoTV que renueva. El comprador lo escribe en su
 * transferencia, queda impreso en el comprobante y el escaneo LLM lo valida
 * contra la orden (src/server/transferencias/verificar.ts).
 *
 * Ciclo de vida (regla de negocio):
 *   - Entrega idempotente: mientras el código esté activo y el mes vigente,
 *     volver a pulsar «Transferencia» devuelve el MISMO código (si el
 *     comprador cancela, el código queda latente hasta el fin de mes).
 *   - TTL mensual: los códigos viven dentro de su `period_month` ('YYYY-MM',
 *     hora del servidor, igual que la verificación de fecha del comprobante);
 *     al vencer el mes se entrega uno nuevo y los viejos ya no se aceptan.
 *   - Anulación: cuando la orden que usa el código termina (aprobada →
 *     `paid` / rechazada → `rejected`), el código se marca `consumed` y la
 *     siguiente transacción del mes recibe uno distinto: cada movimiento
 *     queda trazado con su propio concepto.
 *
 * El alfabeto excluye caracteres ambiguos (0/O y 1/I) para que el código se
 * lea y se copie sin errores; se compara sin distinguir mayúsculas.
 */

/** 32 símbolos sin ambigüedad: 32^4 ≈ 1M de códigos por mes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 4

/** Reintentos ante colisión de código dentro del mes (probabilidad ínfima). */
const MAX_CODE_ATTEMPTS = 8

/**
 * Límite de emisiones de concepto por comprador: 12 por minuto, bucket en
 * memoria (mismo patrón que el escaneo de comprobantes). El INSERT es
 * barato, pero sin tope una cuenta podría acuñar códigos del namespace
 * mensual — único GLOBAL entre compradores — sin control.
 */
const CONCEPT_RATE_LIMIT_MAX = 12
const CONCEPT_RATE_LIMIT_WINDOW_MS = 60_000
const conceptBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimitConceptIssuance(userId: string): boolean {
  const now = Date.now()
  if (conceptBuckets.size > 1000) {
    for (const [key, bucket] of conceptBuckets) {
      if (bucket.resetAt <= now) conceptBuckets.delete(key)
    }
  }
  const bucket = conceptBuckets.get(userId)
  if (!bucket || bucket.resetAt <= now) {
    conceptBuckets.set(userId, {
      count: 1,
      resetAt: now + CONCEPT_RATE_LIMIT_WINDOW_MS,
    })
    return true
  }
  bucket.count += 1
  return bucket.count <= CONCEPT_RATE_LIMIT_MAX
}

/**
 * Tope de conceptos ACTIVOS por comprador y mes (a través de todos sus
 * usuarios): un comprador legítimo acumula pocas intenciones sin pagar; una
 * cuenta que supera el tope está acuñando, no comprando. Los conceptos
 * consumidos no cuentan: cada transferencia terminada libera su espacio.
 */
const MAX_ACTIVE_CONCEPTS_PER_BUYER = 50

export interface TransferConcept {
  id: string
  code: string
  periodMonth: string
}

/** Mes de vigencia actual, 'YYYY-MM' en la hora del servidor. */
export function currentPeriodMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function generateCode(): string {
  let code = ""
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  )
}

async function findActiveConcept(input: {
  buyerUserId: string
  userName: string
  periodMonth: string
}): Promise<TransferConcept | null> {
  const result = await pool.query<{
    id: string
    code: string
    period_month: string
  }>(
    `SELECT id, code, period_month
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND user_name = $2
        AND period_month = $3 AND status = 'active'
      LIMIT 1`,
    [input.buyerUserId, input.userName, input.periodMonth]
  )
  const row = result.rows[0]
  return row
    ? { id: String(row.id), code: String(row.code), periodMonth: String(row.period_month) }
    : null
}

/**
 * Devuelve el código activo del comprador + usuario + mes actual, o genera
 * uno nuevo (único entre los activos del mes). Idempotente: dos peticiones
 * concurrentes acaban con el mismo código (índice único parcial; ante la
 * carrera se relee el ganador).
 */
export async function getOrCreateTransferConcept(input: {
  buyerUserId: string
  userName: string
}): Promise<TransferConcept> {
  const userName = input.userName.trim()
  const periodMonth = currentPeriodMonth()

  const existing = await findActiveConcept({
    buyerUserId: input.buyerUserId,
    userName,
    periodMonth,
  })
  if (existing) return existing

  // Tope por comprador antes de acuñar: sin él, una cuenta podría crecer la
  // tabla sin límite y presionar el namespace mensual de códigos.
  const active = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND period_month = $2
        AND status = 'active'`,
    [input.buyerUserId, periodMonth]
  )
  if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_CONCEPTS_PER_BUYER) {
    throw new AppError(
      422,
      "concepto_limit",
      "Has generado demasiados conceptos de pago este mes. Contacta al administrador."
    )
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateCode()
    try {
      const inserted = await pool.query<{
        id: string
        code: string
        period_month: string
      }>(
        `INSERT INTO transfer_concepts (code, buyer_user_id, user_name, period_month)
         VALUES ($1, $2::uuid, $3, $4)
         RETURNING id, code, period_month`,
        [code, input.buyerUserId, userName, periodMonth]
      )
      const row = inserted.rows[0]
      return {
        id: String(row.id),
        code: String(row.code),
        periodMonth: String(row.period_month),
      }
    } catch (error) {
      lastError = error
      if (!isUniqueViolation(error)) throw error
      // Carrera de dos escenarios: otro request creó el código activo del
      // par (comprador, usuario, mes) → devolverlo; o colisión del código
      // con otro comprador del mes → generar otro.
      const raced = await findActiveConcept({
        buyerUserId: input.buyerUserId,
        userName,
        periodMonth,
      })
      if (raced) return raced
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo generar un concepto de pago único.")
}

/**
 * Resuelve el concepto ACTIVO del mes para el comprador + usuario indicado
 * con el código exacto entregado. Null = código ajeno, vencido o ya anulado:
 * la orden se rechaza en la puerta.
 */
export async function getActiveTransferConcept(input: {
  buyerUserId: string
  userName: string
  code: string
}): Promise<TransferConcept | null> {
  const periodMonth = currentPeriodMonth()
  const result = await pool.query<{
    id: string
    code: string
    period_month: string
  }>(
    `SELECT id, code, period_month
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND user_name = $2
        AND code = $3 AND period_month = $4 AND status = 'active'
      LIMIT 1`,
    [input.buyerUserId, input.userName.trim(), input.code.toUpperCase(), periodMonth]
  )
  const row = result.rows[0]
  return row
    ? { id: String(row.id), code: String(row.code), periodMonth: String(row.period_month) }
    : null
}

/**
 * Anula el concepto ligado a una orden terminada (aprobada o rechazada):
 * la siguiente transacción del comprador recibe un código nuevo. Mejor
 * esfuerzo: el llamador captura y registra el fallo; no bloquea la revisión.
 */
export async function consumeTransferConceptByOrder(orderId: string): Promise<void> {
  await pool.query(
    `UPDATE transfer_concepts c
        SET status = 'consumed', consumed_at = now(), consumed_by_order_id = $1::uuid
       FROM mp_orders o
      WHERE c.id = o.concept_id AND o.id = $1::uuid AND c.status = 'active'`,
    [orderId]
  )
}
