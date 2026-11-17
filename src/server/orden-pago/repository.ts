import { randomInt } from "node:crypto"

import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Órdenes de pago por WhatsApp (/modulos/orden-de-pago): cobros de MONTO
 * LIBRE hacia un pagador EXTERNO (cualquier persona, sin cuenta en el
 * panel). El creador (admin o distribuidor) emite la orden; el pagador
 * recibe una liga wa.me al agente con el código de concepto prellenado,
 * paga por SPEI escribiendo ese código como concepto y manda el comprobante
 * por el mismo chat; el escaneo del flujo de transferencias lo valida y
 * aprueba la orden o la deja en revisión del creador.
 *
 * Ciclo de vida:
 *   - 'pending': activa. El código de 4 caracteres (mismo alfabeto sin
 *     ambigüedad que transfer_concepts) es ÚNICO GLOBAL solo entre las
 *     pendientes (índice único parcial): es el namespace que el pagador
 *     escribe como concepto y por el que el comprobante descubre la orden.
 *   - 'paid' | 'rejected': resueltas (automático o manual con quién en
 *     reviewed_by). El código queda libre para una orden futura; la fila
 *     histórica conserva su código y su comprobante (dedup por sha256).
 *   - 'cancelled': cancelada por el creador sin pago.
 *   Sin caducidad: queda activa hasta resolverse o cancelarse.
 *
 * El snapshot bancario (banco/cuenta/titular) y el monto se congelan al
 * crear: ediciones posteriores del perfil del creador no cambian órdenes
 * vivas, y `bank_holder` es el titular contra el que el escaneo valida el
 * beneficiario del comprobante.
 */

export type PaymentOrderStatus = "pending" | "paid" | "rejected" | "cancelled"

export interface PaymentOrder {
  id: string
  code: string
  creatorUserId: string
  creatorUsername: string | null
  amountMxn: number
  note: string | null
  status: PaymentOrderStatus
  bank: { bank: string; account: string; holder: string }
  payerPhone: string | null
  ticketFileId: string | null
  ticketSha256: string | null
  scanStatus: string | null
  /** Resultado del escaneo (forma ScanResult del flujo de transferencias). */
  scanResult: Record<string, unknown> | null
  resolvedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

/** Límites del monto libre (CHECK de la tabla como respaldo duro). */
export const PAYMENT_ORDER_MIN_MXN = 1
export const PAYMENT_ORDER_MAX_MXN = 50_000

/**
 * Tope de órdenes PENDIENTES simultáneas por creador: un cobrador legítimo
 * acumula pocas órdenes sin pagar; una cuenta que supera el tope está
 * acuñando códigos del namespace global, no cobrando.
 */
export const MAX_PENDING_PAYMENT_ORDERS = 20

/** 32 símbolos sin ambigüedad (mismo alfabeto que transfer_concepts). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 4

/** Reintentos ante colisión de código entre pendientes (probabilidad ínfima). */
const MAX_CODE_ATTEMPTS = 8

/**
 * Límite de emisiones por creador: 12 por minuto, bucket en memoria (mismo
 * patrón que los conceptos de transferencia). El INSERT es barato, pero sin
 * tope una cuenta podría acuñar códigos del namespace — único GLOBAL entre
 * creadores — sin control.
 */
const CREATE_RATE_LIMIT_MAX = 12
const CREATE_RATE_LIMIT_WINDOW_MS = 60_000
const createBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimitPaymentOrderCreation(userId: string): boolean {
  const now = Date.now()
  if (createBuckets.size > 1000) {
    for (const [key, bucket] of createBuckets) {
      if (bucket.resetAt <= now) createBuckets.delete(key)
    }
  }
  const bucket = createBuckets.get(userId)
  if (!bucket || bucket.resetAt <= now) {
    createBuckets.set(userId, {
      count: 1,
      resetAt: now + CREATE_RATE_LIMIT_WINDOW_MS,
    })
    return true
  }
  bucket.count += 1
  return bucket.count <= CREATE_RATE_LIMIT_MAX
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

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value as string).toISOString()
}

function mapRow(row: Record<string, unknown>): PaymentOrder {
  return {
    id: String(row.id),
    code: String(row.code),
    creatorUserId: String(row.creator_user_id),
    creatorUsername:
      row.creator_username === null || row.creator_username === undefined
        ? null
        : String(row.creator_username),
    amountMxn: Number(row.amount_mxn),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    status: row.status as PaymentOrderStatus,
    bank: {
      bank: String(row.bank_name),
      account: String(row.bank_account),
      holder: String(row.bank_holder),
    },
    payerPhone:
      row.payer_phone === null || row.payer_phone === undefined
        ? null
        : String(row.payer_phone),
    ticketFileId:
      row.ticket_file_id === null || row.ticket_file_id === undefined
        ? null
        : String(row.ticket_file_id),
    ticketSha256:
      row.ticket_sha256 === null || row.ticket_sha256 === undefined
        ? null
        : String(row.ticket_sha256),
    scanStatus:
      row.scan_status === null || row.scan_status === undefined
        ? null
        : String(row.scan_status),
    scanResult:
      row.scan_result === null || row.scan_result === undefined
        ? null
        : (row.scan_result as Record<string, unknown>),
    resolvedAt: isoOrNull(row.resolved_at),
    rejectionReason:
      row.rejection_reason === null || row.rejection_reason === undefined
        ? null
        : String(row.rejection_reason),
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

const SELECT_COLUMNS = `
  SELECT o.id, o.code, o.creator_user_id, u.username AS creator_username,
         o.amount_mxn, o.note, o.status, o.bank_name, o.bank_account,
         o.bank_holder, o.payer_phone, o.ticket_file_id, o.ticket_sha256,
         o.scan_status, o.scan_result, o.resolved_at, o.rejection_reason,
         o.created_at
    FROM payment_orders o
    LEFT JOIN users u ON u.id = o.creator_user_id`

/**
 * Crea la orden 'pending' con su código único entre pendientes y el
 * snapshot bancario/monto congelados. Lanza AppError con mensajes listos
 * para la UI (tope de pendientes, colisión agotada).
 */
export async function createPaymentOrder(input: {
  creatorUserId: string
  amountMxn: number
  note: string | null
  bank: { bank: string; account: string; holder: string }
}): Promise<PaymentOrder> {
  // Tope por creador antes de acuñar.
  const active = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM payment_orders
      WHERE creator_user_id = $1::uuid AND status = 'pending'`,
    [input.creatorUserId]
  )
  if ((active.rows[0]?.n ?? 0) >= MAX_PENDING_PAYMENT_ORDERS) {
    throw new AppError(
      422,
      "payment_order_limit",
      `Tienes ${MAX_PENDING_PAYMENT_ORDERS} órdenes de pago pendientes. Resuelve o cancela alguna antes de crear otra.`
    )
  }

  const amount = Math.round(input.amountMxn * 100) / 100
  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateCode()
    try {
      const result = await pool.query(
        `INSERT INTO payment_orders
           (code, creator_user_id, amount_mxn, note, bank_name, bank_account, bank_holder)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          code,
          input.creatorUserId,
          amount,
          input.note,
          input.bank.bank,
          input.bank.account,
          input.bank.holder,
        ]
      )
      const created = await getPaymentOrder(String(result.rows[0].id))
      if (!created) {
        throw new Error("La orden de pago no se pudo leer tras crearse.")
      }
      return created
    } catch (error) {
      lastError = error
      if (!isUniqueViolation(error)) throw error
      // Colisión del código con otra orden pendiente: generar otro.
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo generar un código de pago único.")
}

export async function getPaymentOrder(id: string): Promise<PaymentOrder | null> {
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS} WHERE o.id = $1::uuid LIMIT 1`,
    [id]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * Primera orden pendiente que matchee CUALQUIERA de los códigos dados (la
 * más vieja: determinista si dos códigos coincidieran). Es la puerta única
 * del canal WhatsApp para los tokens de un mensaje: UNA consulta por turno,
 * no una por token (un mensaje grande con decenas de palabras con forma de
 * código no debe sondear la tabla token a token).
 */
export async function findPendingPaymentOrderByAnyCode(
  codes: string[]
): Promise<PaymentOrder | null> {
  const normalized = [
    ...new Set(
      codes.map((code) => code.trim().toUpperCase()).filter((code) => code.length > 0)
    ),
  ]
  if (normalized.length === 0) return null
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.code = ANY($1) AND o.status = 'pending'
      ORDER BY o.created_at ASC LIMIT 1`,
    [normalized]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * Primera orden NO pendiente que matchee cualquiera de los códigos (replay
 * honesto, la más recientemente resuelta). Null = ningún código corresponde
 * a una orden resuelta.
 */
export async function findResolvedPaymentOrderByAnyCode(
  codes: string[]
): Promise<PaymentOrder | null> {
  const normalized = [
    ...new Set(
      codes.map((code) => code.trim().toUpperCase()).filter((code) => code.length > 0)
    ),
  ]
  if (normalized.length === 0) return null
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.code = ANY($1) AND o.status <> 'pending'
      ORDER BY o.resolved_at DESC NULLS LAST LIMIT 1`,
    [normalized]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * TODAS las órdenes pendientes de UN monto exacto (del más viejo al más
 * nuevo, con tope de seguridad). Es la puerta del canal WhatsApp para la
 * SOLICITUD prellenada de la liga («Solicito una orden de pago por $X»),
 * que viaja sin código: la orden se descubre por el importe que el
 * cobrador definió.
 */
export async function listPendingPaymentOrdersByAmount(
  amountMxn: number,
  limit = 200
): Promise<PaymentOrder[]> {
  const amount = Math.round(amountMxn * 100) / 100
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 500)
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.status = 'pending' AND o.amount_mxn = $1::numeric
      ORDER BY o.created_at ASC LIMIT $2`,
    [amount, capped]
  )
  return result.rows.map(mapRow)
}

/**
 * Última orden NO pendiente ligada al teléfono del pagador (la más
 * recientemente resuelta). Replay honesto de una solicitud por monto cuyo
 * código ya no está entre las pendientes: el pagador que reenvía la
 * solicitud tras un pago resuelto recibe el estado REAL de su orden.
 */
export async function findLatestResolvedPaymentOrderByPayerPhone(
  phone: string
): Promise<PaymentOrder | null> {
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.payer_phone = $1 AND o.status <> 'pending'
      ORDER BY o.resolved_at DESC NULLS LAST LIMIT 1`,
    [phone]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * TODAS las órdenes pendientes, del más viejo al más nuevo, con tope de
 * seguridad. Es la base del descubrimiento por comprobante: el código
 * IMPRESO en el comprobante se busca entre estas órdenes para identificar
 * a cuál pertenece el pago (sin pedirle nada más al pagador).
 */
export async function listPendingPaymentOrders(limit = 200): Promise<PaymentOrder[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 500)
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS} WHERE o.status = 'pending' ORDER BY o.created_at ASC LIMIT $1`,
    [capped]
  )
  return result.rows.map(mapRow)
}

/** Últimas órdenes (del creador o todas para el admin), más nuevas primero. */
export async function listPaymentOrders(input: {
  creatorUserId?: string
  limit?: number
}): Promise<PaymentOrder[]> {
  const capped = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 200)
  const result = input.creatorUserId
    ? await pool.query<Record<string, unknown>>(
        `${SELECT_COLUMNS} WHERE o.creator_user_id = $1::uuid
         ORDER BY o.created_at DESC LIMIT $2`,
        [input.creatorUserId, capped]
      )
    : await pool.query<Record<string, unknown>>(
        `${SELECT_COLUMNS} ORDER BY o.created_at DESC LIMIT $1`,
        [capped]
      )
  return result.rows.map(mapRow)
}

/** Guarda el teléfono del pagador capturado en su primer contacto. */
export async function touchPaymentOrderPayer(
  orderId: string,
  phone: string
): Promise<void> {
  await pool.query(
    `UPDATE payment_orders
        SET payer_phone = $2, updated_at = now()
      WHERE id = $1::uuid AND payer_phone IS NULL`,
    [orderId, phone]
  )
}

export interface PaymentOrderScanRow {
  scanStatus: string
  scanResult: Record<string, unknown> | null
  scanModel: string | null
  ticketFileId: string | null
  ticketSha256: string | null
}

/**
 * Persiste el resultado del escaneo del comprobante (espejo de `guardarScan`
 * del flujo de transferencias) junto con el archivo recibido: el ticket
 * queda ligado a la orden como evidencia para la revisión manual.
 */
export async function savePaymentOrderScan(input: {
  orderId: string
  scanStatus: string
  scanResult: Record<string, unknown> | null
  scanModel: string | null
  ticketFileId: string | null
  ticketSha256: string | null
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET scan_status = $2, scan_result = $3::jsonb, scan_model = $4,
            scan_at = now(), ticket_file_id = COALESCE($5::uuid, ticket_file_id),
            ticket_sha256 = COALESCE($6, ticket_sha256), updated_at = now()
      WHERE id = $1::uuid`,
    [
      input.orderId,
      input.scanStatus,
      input.scanResult ? JSON.stringify(input.scanResult) : null,
      input.scanModel,
      input.ticketFileId,
      input.ticketSha256,
    ]
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Reclama la orden pendiente y la resuelve (`pending → paid | rejected |
 * cancelled`) de forma atómica: solo UN llamador gana aunque dos revisores
 * actúen a la vez (escaneo automático concurrente con el botón del
 * creador). Devuelve la orden ya resuelta, o null si otro la resolvió
 * primero.
 */
export async function resolvePaymentOrder(input: {
  orderId: string
  decision: "paid" | "rejected" | "cancelled"
  reviewedBy: string
  rejectionReason?: string | null
}): Promise<PaymentOrder | null> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET status = $2, reviewed_by = $3::uuid, resolved_at = now(),
            rejection_reason = $4, updated_at = now()
      WHERE id = $1::uuid AND status = 'pending'
      RETURNING id`,
    [
      input.orderId,
      input.decision,
      input.reviewedBy,
      input.rejectionReason ?? null,
    ]
  )
  if ((result.rowCount ?? 0) === 0) return null
  return getPaymentOrder(input.orderId)
}

/**
 * Cancela una orden pendiente (solo el creador o un admin): el código queda
 * libre y el pagador que llegue tarde recibe el replay de «orden
 * cancelada». El claim atómico es el mismo de `resolvePaymentOrder`.
 */
export async function cancelPaymentOrder(input: {
  orderId: string
  reviewedBy: string
}): Promise<PaymentOrder | null> {
  return resolvePaymentOrder({
    orderId: input.orderId,
    decision: "cancelled",
    reviewedBy: input.reviewedBy,
    rejectionReason: null,
  })
}
