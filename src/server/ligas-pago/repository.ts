import { randomInt } from "node:crypto"

import { pool, type PoolClientLike } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/*
 * Órdenes de pago por WhatsApp (/modulos/ligas-de-pago): cobros de MONTO
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
 *     ACTIVAS (pending + verifying, índice único parcial): es el namespace
 *     que el pagador escribe como concepto y por el que el comprobante
 *     descubre la orden.
 *   - 'verifying': comprobante válido (escaneo aprobado), esperando la
 *     confirmación del DEPÓSITO en la cuenta de Mercado Pago del creador
 *     (credencial propia o la de plataforma para el admin; misma fuente que
 *     /modulos/reporte-spei, ambos rieles). MP no expone el concepto
 *     escrito por el pagador, así que el depósito se casa por importe
 *     exacto + ventana y el ID del pago de MP queda reservado en exclusiva
 *     (mp_payment_id, índice único parcial): un depósito valida una sola
 *     orden. Tras 24 h sin depósito el verificador escala a manual.
 *   - 'paid' | 'rejected': resueltas (automático o manual con quién en
 *     reviewed_by). El código queda libre para una orden futura; la fila
 *     histórica conserva su código y su comprobante (dedup por sha256).
 *   - 'cancelled': cancelada por el creador sin pago.
 *   Sin caducidad: queda activa hasta resolverse o cancelarse (el creador
 *   puede resolver manualmente desde 'verifying': la verificación del
 *   depósito es red de seguridad, no jaula).
 *
 * El snapshot bancario (banco/cuenta/titular) y el monto se congelan al
 * crear: ediciones posteriores del perfil del creador no cambian órdenes
 * vivas, y `bank_holder` es el titular contra el que el escaneo valida el
 * beneficiario del comprobante.
 */

export type PaymentOrderStatus =
  | "pending"
  | "verifying"
  | "paid"
  | "rejected"
  | "cancelled"

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
  /** ID del pago de MP que confirmó el depósito (exclusivo por orden). */
  mpPaymentId: string | null
  /** Fecha de acreditación del depósito según MP. */
  mpDepositAt: string | null
  /** Cuándo entró en verificación de depósito (base del tope de 24 h). */
  verifyingSince: string | null
  /** Próximo sondeo programado del verificador (backoff). */
  depositNextCheckAt: string | null
  /** Sondeos sin hallazgo (elige el tramo de backoff). */
  depositChecks: number
  /** Escalamiento a resolución manual ya avisado (una sola vez). */
  depositEscalatedAt: string | null
}

/** Límites del monto libre (CHECK de la tabla como respaldo duro). */
export { PAYMENT_ORDER_MAX_MXN, PAYMENT_ORDER_MIN_MXN } from "@/lib/ligas-pago"

/**
 * Tope de órdenes ACTIVAS simultáneas por creador (pending + verifying): un
 * cobrador legítimo acumula pocas órdenes sin pagar; una cuenta que supera
 * el tope está acuñando códigos del namespace global, no cobrando.
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
    mpPaymentId:
      row.mp_payment_id === null || row.mp_payment_id === undefined
        ? null
        : String(row.mp_payment_id),
    mpDepositAt: isoOrNull(row.mp_deposit_at),
    verifyingSince: isoOrNull(row.verifying_since),
    depositNextCheckAt: isoOrNull(row.deposit_next_check_at),
    depositChecks: Number(row.deposit_checks ?? 0),
    depositEscalatedAt: isoOrNull(row.deposit_escalated_at),
  }
}

const SELECT_COLUMNS = `
  SELECT o.id, o.code, o.creator_user_id, u.username AS creator_username,
         o.amount_mxn, o.note, o.status, o.bank_name, o.bank_account,
         o.bank_holder, o.payer_phone, o.ticket_file_id, o.ticket_sha256,
         o.scan_status, o.scan_result, o.resolved_at, o.rejection_reason,
         o.created_at, o.mp_payment_id, o.mp_deposit_at, o.verifying_since,
         o.deposit_next_check_at, o.deposit_checks, o.deposit_escalated_at
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
  // Tope por creador antes de acuñar (las ACTIVAS cuentan: pending +
  // verifying reservan código y namespace igual).
  const active = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM payment_orders
      WHERE creator_user_id = $1::uuid AND status IN ('pending','verifying')`,
    [input.creatorUserId]
  )
  if ((active.rows[0]?.n ?? 0) >= MAX_PENDING_PAYMENT_ORDERS) {
    throw new AppError(
      422,
      "payment_order_limit",
      `Tienes ${MAX_PENDING_PAYMENT_ORDERS} ligas de pago pendientes. Resuelve o cancela alguna antes de crear otra.`
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
        throw new Error("La liga de pago no se pudo leer tras crearse.")
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
 * Primera orden ACTIVA (pending o verifying) que matchee CUALQUIERA de los
 * códigos dados (la más vieja: determinista si dos códigos coincidieran).
 * Es la puerta única del canal WhatsApp para los tokens de un mensaje: UNA
 * consulta por turno, no una por token (un mensaje grande con decenas de
 * palabras con forma de código no debe sondear la tabla token a token). Una
 * orden en 'verifying' sigue activa: el pagador puede reenviar su código y
 * el código no fue liberado.
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
      WHERE o.code = ANY($1) AND o.status IN ('pending','verifying')
      ORDER BY o.created_at ASC LIMIT 1`,
    [normalized]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * Primera orden RESUELTA (paid/rejected/cancelled; 'verifying' NO lo es)
 * que matchee cualquiera de los códigos (replay honesto, la más
 * recientemente resuelta). Null = ningún código corresponde a una orden
 * resuelta.
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
      WHERE o.code = ANY($1) AND o.status IN ('paid','rejected','cancelled')
      ORDER BY o.resolved_at DESC NULLS LAST LIMIT 1`,
    [normalized]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * TODAS las órdenes ACTIVAS (pending + verifying) de UN monto exacto (del
 * más viejo al más nuevo, con tope de seguridad). Es la puerta del canal
 * WhatsApp para la SOLICITUD prellenada de la liga («Solicito una orden de
 * pago por $X»), que viaja sin código: la orden se descubre por el importe
 * que el cobrador definió.
 */
export async function listPendingPaymentOrdersByAmount(
  amountMxn: number,
  limit = 200
): Promise<PaymentOrder[]> {
  const amount = Math.round(amountMxn * 100) / 100
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 500)
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.status IN ('pending','verifying') AND o.amount_mxn = $1::numeric
      ORDER BY o.created_at ASC LIMIT $2`,
    [amount, capped]
  )
  return result.rows.map(mapRow)
}

/**
 * Última orden RESUELTA ligada al teléfono del pagador (la más
 * recientemente resuelta). Replay honesto de una solicitud por monto cuyo
 * código ya no está entre las activas: el pagador que reenvía la solicitud
 * tras un pago resuelto recibe el estado REAL de su orden.
 */
export async function findLatestResolvedPaymentOrderByPayerPhone(
  phone: string
): Promise<PaymentOrder | null> {
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.payer_phone = $1 AND o.status IN ('paid','rejected','cancelled')
      ORDER BY o.resolved_at DESC NULLS LAST LIMIT 1`,
    [phone]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/**
 * TODAS las órdenes activas (pending + verifying), del más viejo al más
 * nuevo, con tope de seguridad. Es la base del descubrimiento por
 * comprobante: el código IMPRESO en el comprobante se busca entre estas
 * órdenes para identificar a cuál pertenece el pago (sin pedirle nada más
 * al pagador).
 */
export async function listPendingPaymentOrders(limit = 200): Promise<PaymentOrder[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 500)
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS} WHERE o.status IN ('pending','verifying') ORDER BY o.created_at ASC LIMIT $1`,
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
 * Reclama la orden ACTIVA (pending o verifying — el override manual del
 * creador funciona también durante la verificación de depósito) y la
 * resuelve (`→ paid | rejected | cancelled`) de forma atómica: solo UN
 * llamador gana aunque dos revisores actúen a la vez (escaneo automático
 * concurrente con el botón del creador). Devuelve la orden ya resuelta, o
 * null si otro la resolvió primero.
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
            rejection_reason = $4,
            deposit_next_check_at = NULL, updated_at = now()
      WHERE id = $1::uuid AND status IN ('pending','verifying')
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
 * Cancela una orden activa (solo el creador o un admin): el código queda
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

/**
 * Reserva CRUZADA de depósitos: los IDs de pago de MP ya reclamados por
 * CUALQUIER orden (ligas de pago `payment_orders` o renovaciones
 * `mp_orders`). Ambos flujos leen la MISMA cuenta de Mercado Pago, así que
 * un depósito solo puede confirmar UNA orden en todo el panel — el índice
 * único de cada tabla no ve la otra.
 */
export async function findReservedMpPaymentIds(
  mpPaymentIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(mpPaymentIds.filter((id) => id.length > 0))]
  const reserved = new Set<string>()
  if (ids.length === 0) return reserved
  const [orders, renewals] = await Promise.all([
    pool.query<{ mp_payment_id: string }>(
      `SELECT mp_payment_id FROM payment_orders
        WHERE mp_payment_id = ANY($1) AND mp_payment_id IS NOT NULL`,
      [ids]
    ),
    pool.query<{ mp_payment_id: string }>(
      `SELECT mp_payment_id FROM mp_orders
        WHERE mp_payment_id = ANY($1) AND mp_payment_id IS NOT NULL`,
      [ids]
    ),
  ])
  for (const row of orders.rows) reserved.add(String(row.mp_payment_id))
  for (const row of renewals.rows) reserved.add(String(row.mp_payment_id))
  return reserved
}

/**
 * Re-verificación AUTORITATIVA de la reserva de un depósito, a correr DENTRO
 * de la transacción que reclama (con el advisory lock del ID de pago tomado
 * — ver `confirmPaymentOrderDeposit`): los índices únicos son por tabla y no
 * se ven entre sí, así que el check-then-claim suelto tiene una ventana
 * TOCTOU entre los dos verificadores (comparten la misma cuenta MP y el
 * mismo pool de depósitos). Bajo el candado, esta consulta es la última
 * palabra: `true` = otro flujo ya reclamó el pago.
 */
export async function isMpDepositClaimed(
  client: PoolClientLike,
  mpPaymentId: string,
  exclude?: { paymentOrderId?: string; mpOrderId?: string }
): Promise<boolean> {
  const result = await client.query(
    `SELECT (
       EXISTS (
         SELECT 1 FROM payment_orders
          WHERE mp_payment_id = $1::bigint
            AND ($3::uuid IS NULL OR id <> $3::uuid)
       )
       OR EXISTS (
         SELECT 1 FROM mp_orders
          WHERE mp_payment_id = $1::bigint
            AND ($4::uuid IS NULL OR id <> $4::uuid)
       )
     ) AS taken`,
    [
      mpPaymentId,
      mpPaymentId,
      exclude?.paymentOrderId ?? null,
      exclude?.mpOrderId ?? null,
    ]
  )
  const taken = (result.rows[0] as { taken?: boolean } | undefined)?.taken
  return taken === true
}

/* -------------------------------------------------------------------------- */
/*          Verificación de depósito (reporte SPEI sobre la orden)            */
/* -------------------------------------------------------------------------- */

/**
 * Claim atómico `pending → verifying` tras un comprobante válido: fija el
 * inicio de la verificación (base del tope de 24 h) y programa el primer
 * sondeo del verificador con el primer tramo de backoff — el chequeo
 * inmediato ya corre dentro del turno que aprueba el comprobante; sondear
 * de nuevo al instante duplicaría esa consulta y podría ganar la carrera
 * contra él (avisos contradictorios).
 * Null = otro actor ya resolvió la orden.
 */
export async function markPaymentOrderVerifying(orderId: string): Promise<PaymentOrder | null> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET status = 'verifying', verifying_since = now(),
            deposit_next_check_at = now() + interval '2 minutes', deposit_checks = 0,
            deposit_escalated_at = NULL, updated_at = now()
      WHERE id = $1::uuid AND status = 'pending'
      RETURNING id`,
    [orderId]
  )
  if ((result.rowCount ?? 0) === 0) return null
  return getPaymentOrder(orderId)
}

/**
 * Órdenes en 'verifying' con sondeo vencido y sin escalar (la cola del
 * verificador), la más atrasada primero, con tope por tick. SOLO creadores
 * con verificación posible (credencial propia de MP o admin con la de
 * plataforma): los demás cobros apuntan a una cuenta sin credencial
 * consultable y su verificación es manual por diseño.
 */
export async function listDueVerifyingOrders(limit = 4): Promise<PaymentOrder[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 20)
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.status = 'verifying' AND deposit_escalated_at IS NULL
        AND deposit_next_check_at IS NOT NULL AND deposit_next_check_at <= now()
        AND EXISTS (
          SELECT 1 FROM users u2
           WHERE u2.id = o.creator_user_id
             AND (u2.role = 'admin'
                  OR EXISTS (
                    SELECT 1 FROM user_mp_tokens t
                     WHERE t.user_id = u2.id AND t.status = 'active'
                  ))
        )
      ORDER BY o.deposit_next_check_at ASC LIMIT $1`,
    [capped]
  )
  return result.rows.map(mapRow)
}

/**
 * Registra el resultado de un sondeo sin hallazgo: incrementa el contador
 * (elige el tramo de backoff) y programa el siguiente intento. Solo toca
 * órdenes aún en 'verifying'.
 */
export async function savePaymentOrderDepositCheck(input: {
  orderId: string
  checks: number
  nextCheckAt: Date
}): Promise<void> {
  await pool.query(
    `UPDATE payment_orders
        SET deposit_checks = $2, deposit_next_check_at = $3, updated_at = now()
      WHERE id = $1::uuid AND status = 'verifying'`,
    [input.orderId, input.checks, input.nextCheckAt]
  )
}

/**
 * Escalamiento una sola vez tras el tope de espera: sella la fecha y saca
 * la orden de la cola de sondeo (deposit_next_check_at = NULL). Devuelve
 * true solo para el primer llamador (los avisos salen una vez).
 */
export async function markDepositEscalated(orderId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET deposit_escalated_at = now(), deposit_next_check_at = NULL, updated_at = now()
      WHERE id = $1::uuid AND status = 'verifying' AND deposit_escalated_at IS NULL
      RETURNING id`,
    [orderId]
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Confirmación atómica del depósito: reclama la orden en 'verifying' y la
 * resuelve `paid` reservando el ID del pago de MP. La exclusividad es
 * CRUZADA con las renovaciones (`mp_orders` — ambos flujos leen la misma
 * cuenta): el advisory lock por ID de pago serializa a los dos reclamantes
 * y `isMpDepositClaimed` re-verifica DENTRO del candado (los índices únicos
 * de cada tabla no se ven entre sí). `reviewedBy` es el propio creador
 * (aprobación automática con quién). Null = otro actor ganó el depósito o
 * la orden.
 */
export async function confirmPaymentOrderDeposit(input: {
  orderId: string
  mpPaymentId: string
  mpDepositAt: string | null
  reviewedBy: string
}): Promise<PaymentOrder | null> {
  const tx = await pool.connect()
  try {
    await tx.query("BEGIN")
    // Clave del candado = el ID del pago de MP en texto (la MISMA que usa el
    // claim de renovaciones en mercadopago/service.ts).
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.mpPaymentId,
    ])
    if (
      await isMpDepositClaimed(tx, input.mpPaymentId, {
        paymentOrderId: input.orderId,
      })
    ) {
      await tx.query("ROLLBACK").catch(() => {})
      return null
    }
    const result = await tx.query(
      `UPDATE payment_orders
          SET status = 'paid', reviewed_by = $4::uuid, resolved_at = now(),
              mp_payment_id = $2, mp_deposit_at = $3::timestamptz,
              deposit_next_check_at = NULL, updated_at = now()
        WHERE id = $1::uuid AND status = 'verifying' AND mp_payment_id IS NULL
        RETURNING id`,
      [input.orderId, input.mpPaymentId, input.mpDepositAt, input.reviewedBy]
    )
    if ((result.rowCount ?? 0) === 0) {
      await tx.query("ROLLBACK").catch(() => {})
      return null
    }
    await tx.query("COMMIT")
    return getPaymentOrder(input.orderId)
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {})
    if (isUniqueViolation(error)) return null
    throw error
  } finally {
    tx.release()
  }
}

/**
 * Códigos de órdenes de pago ligados a IDs de pagos de MP (columna
 * «Concepto» del reporte SPEI): el link es DETERMINISTA (el depósito que
 * confirmó la orden), no una inferencia por ventana.
 */
export async function findPaymentOrdersByMpPaymentIds(
  mpPaymentIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(mpPaymentIds.filter((id) => id.length > 0))]
  const result = new Map<string, string>()
  if (ids.length === 0) return result
  const rows = await pool.query<{ id: string; mp_payment_id: string; code: string }>(
    `SELECT id::text, mp_payment_id, code
       FROM payment_orders
      WHERE mp_payment_id = ANY($1)`,
    [ids]
  )
  for (const row of rows.rows) {
    result.set(String(row.mp_payment_id), String(row.code))
  }
  return result
}
