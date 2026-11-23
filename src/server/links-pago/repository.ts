import { randomInt } from "node:crypto"

import {
  pool,
  systemPool,
  type PoolClientLike,
  setTenantContextInTx,
} from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"
import { AppError } from "@/server/umejson/types"
import { paymentOrderConceptAnchor } from "@/lib/links-pago"

/*
 * Órdenes de pago por WhatsApp (/modulos/links-de-pago): cobros de MONTO
 * LIBRE hacia un pagador EXTERNO (cualquier persona, sin cuenta en el
 * panel). El creador (admin o distribuidor) emite la orden con IMPORTE y
 * CONCEPTO DE PAGO (una palabra alfanumérica obligatoria); el pagador
 * recibe un link wa.me al agente con la solicitud prellenada, solicita el
 * pago y el agente le ENTREGA el concepto de pago; paga por SPEI escribiendo
 * esa palabra como concepto y manda el comprobante por el mismo chat; el
 * escaneo del flujo de transferencias lo valida contra la palabra y aprueba
 * la orden o la deja en revisión del creador. La conciliación vive contra
 * la PALABRA (`note`); el código de 4 caracteres solo identifica el link
 * corto (spei.link/CÓDIGO) y desambigua.
 *
 * Ciclo de vida:
 *   - 'pending': activa. El código de 4 caracteres (mismo alfabeto sin
 *     ambigüedad que transfer_concepts) es ÚNICO GLOBAL solo entre las
 *     ACTIVAS (pending + verifying, índice único parcial): identifica el
 *     link corto. El concepto de pago (palabra) es el ancla del comprobante
 *     y queda OCULTO hasta que el pagador solicita el pago por WhatsApp.
 *     La identificación del pagador por el concepto es MANDATORIA: sin
 *     comprobante que pase el escaneo con el concepto impreso la orden NO
 *     se autoconfirma por depósito (ni siquiera con monto único) — queda
 *     pendiente para el creador.
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
  /** Tenant de la orden (RLS); lo trae la resolución pública del link corto. */
  tenantId: string
  creatorUserId: string
  creatorUsername: string | null
  amountMxn: number
  note: string | null
  status: PaymentOrderStatus
  bank: { bank: string; account: string; holder: string }
  payerPhone: string | null
  /** Primera apertura del link corto (spei.link → wa.me). */
  linkOpenedAt: string | null
  /** Primer contacto del pagador (teléfono ligado por entrega del código). */
  payerBoundAt: string | null
  /** Recordatorio proactivo ya enviado (uno solo por orden). */
  payerNudgedAt: string | null
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
export { PAYMENT_ORDER_MAX_MXN, PAYMENT_ORDER_MIN_MXN } from "@/lib/links-pago"

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

/**
 * Señal de tiempo real (kind `payment_order`) tras cada mutación que cambia
 * el listado del módulo: creación, escaneo del comprobante, contacto del
 * pagador, verifying/paid/rejected/cancelled, sondeos y escalamiento. Llega
 * a todas las sesiones (el alcance ya lo filtra cada refetch) y el provider
 * refresca el RSC — /modulos/links-de-pago se actualiza sin recargar.
 * Best-effort: jamás rompe la mutación que la origina.
 */
function notifyPaymentOrderChange(orderId: string): void {
  publishRealtimeDetached({ kind: "payment_order", entityId: orderId })
}

function mapRow(row: Record<string, unknown>): PaymentOrder {
  return {
    id: String(row.id),
    code: String(row.code),
    tenantId: String(row.tenant_id),
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
    linkOpenedAt: isoOrNull(row.link_opened_at),
    payerBoundAt: isoOrNull(row.payer_bound_at),
    payerNudgedAt: isoOrNull(row.payer_nudged_at),
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
         o.bank_holder, o.payer_phone, o.link_opened_at, o.payer_bound_at,
         o.payer_nudged_at, o.ticket_file_id, o.ticket_sha256,
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
      `Tienes ${MAX_PENDING_PAYMENT_ORDERS} links de pago pendientes. Resuelve o cancela alguna antes de crear otra.`
    )
  }

  const amount = Math.round(input.amountMxn * 100) / 100
  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateCode()
    try {
      const result = await pool.query(
        `INSERT INTO payment_orders
           (code, creator_user_id, amount_mxn, note, bank_name, bank_account,
            bank_holder)
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
        throw new Error("El link de pago no se pudo leer tras crearse.")
      }
      notifyPaymentOrderChange(created.id)
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
  // Lista blanca (§4.2): la ruta pública spei.link/<código> resuelve la
  // orden SIN contexto de tenant (el pagador externo no tiene sesión);
  // el resto de la petición corre bajo runWithTenant(order.tenant_id).
  const result = await systemPool.query<Record<string, unknown>>(
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
  // Lista blanca (§4.2): replay honesto de la ruta pública (sin contexto).
  const result = await systemPool.query<Record<string, unknown>>(
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
 * WhatsApp para la SOLICITUD prellenada del link («Solicito una orden de
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

/**
 * Guarda el teléfono del pagador capturado en su primer contacto y fija
 * `payer_bound_at`. El binding ocurre cuando el sistema ENTREGA el código a
 * ese chat (solicitud por monto con candidata única, código explícito o
 * comprobante): la entrega del código ES la identidad del pagador — el link
 * solo la comparte el cobrador con su pagador. Devuelve true solo en el
 * PRIMER binding (NULL → teléfono): el llamador avisa al creador una sola
 * vez por orden. Re-bindings (mismo u otro teléfono tras resolución) no
 * aplican: el WHERE exige `payer_phone IS NULL`.
 */
export async function touchPaymentOrderPayer(
  orderId: string,
  phone: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET payer_phone = $2, payer_bound_at = now(), updated_at = now()
      WHERE id = $1::uuid AND payer_phone IS NULL
      RETURNING id`,
    [orderId, phone]
  )
  const bound = (result.rowCount ?? 0) > 0
  if (bound) notifyPaymentOrderChange(orderId)
  return bound
}

/**
 * Primera apertura del link corto (spei.link/<CÓDIGO> → 302 a wa.me):
 * escribe `link_opened_at` UNA sola vez y solo si la orden sigue ACTIVA.
 * Etapa de trazabilidad del embudo — no interviene en decisiones de dinero.
 */
export async function markPaymentOrderLinkOpened(orderId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET link_opened_at = now(), updated_at = now()
      WHERE id = $1::uuid AND link_opened_at IS NULL
        AND status IN ('pending','verifying')
      RETURNING id`,
    [orderId]
  )
  const opened = (result.rowCount ?? 0) > 0
  if (opened) notifyPaymentOrderChange(orderId)
  return opened
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
  const saved = (result.rowCount ?? 0) > 0
  if (saved) notifyPaymentOrderChange(input.orderId)
  return saved
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
  const resolved = await getPaymentOrder(input.orderId)
  if (resolved) notifyPaymentOrderChange(resolved.id)
  return resolved
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
 * CUALQUIER orden (links de pago `payment_orders` o renovaciones
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
  // Lista de trabajo cross-tenant (§4.2): la reserva de depósitos es GLOBAL
  // (payment_orders + mp_orders comparten la cuenta MP de plataforma); el
  // check corre sobre systemPool para ver reservas de todos los tenants.
  const [orders, renewals] = await Promise.all([
    systemPool.query<{ mp_payment_id: string }>(
      `SELECT mp_payment_id FROM payment_orders
        WHERE mp_payment_id = ANY($1) AND mp_payment_id IS NOT NULL`,
      [ids]
    ),
    systemPool.query<{ mp_payment_id: string }>(
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
 *
 * TIPOS: `payment_orders.mp_payment_id` es TEXT y `mp_orders.mp_payment_id`
 * es BIGINT — el cast se hace POR TABLA ($1::text / $2::bigint sobre el
 * mismo ID). Un cast único ::bigint contra la columna text fallaba con
 * «operator does not exist: text = bigint» y rompía TODO claim de link (y
 * de renovación con verificación de depósito).
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
          WHERE mp_payment_id = $1::text
            AND ($3::uuid IS NULL OR id <> $3::uuid)
       )
       OR EXISTS (
         SELECT 1 FROM mp_orders
          WHERE mp_payment_id = $2::bigint
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
 * sondeo del verificador a +45 s — el chequeo inmediato ya corrió DENTRO
 * del turno (presupuesto ≤8 s), así que +45 s no compite con él: es la
 * segunda oportunidad para depósitos que acreditan segundos después del
 * comprobante (caso común en SPEI). Antes era +2 min y el confirmar
 * tardaba hasta 2 min + fase de tick tras la acreditación.
 * Null = otro actor ya resolvió la orden.
 */
export async function markPaymentOrderVerifying(orderId: string): Promise<PaymentOrder | null> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET status = 'verifying', verifying_since = now(),
            deposit_next_check_at = now() + interval '45 seconds', deposit_checks = 0,
            deposit_escalated_at = NULL, updated_at = now()
      WHERE id = $1::uuid AND status = 'pending'
      RETURNING id`,
    [orderId]
  )
  if ((result.rowCount ?? 0) === 0) return null
  const verifying = await getPaymentOrder(orderId)
  if (verifying) notifyPaymentOrderChange(verifying.id)
  return verifying
}

/**
 * Filtro de la cola de verificación: SOLO creadores con credencial
 * consultable para la cuenta receptora (propia del distribuidor o la de
 * plataforma para el admin). Los demás cobros apuntan a una cuenta sin
 * credencial y su verificación es manual por diseño. El alias de la orden
 * (`o`) viaja como parámetro para que la definición de «reclamante con
 * credencial» viva UNA sola vez sin copias que puedan divergir.
 */
function depositCredentialExistsSql(orderAlias: string): string {
  return `
          SELECT 1 FROM users u2
           WHERE u2.id = ${orderAlias}.creator_user_id
             AND (u2.role = 'admin'
                  OR EXISTS (
                    SELECT 1 FROM user_mp_tokens t
                     WHERE t.user_id = u2.id AND t.status = 'active'
                  ))`
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
        AND EXISTS (${depositCredentialExistsSql("o")})
      ORDER BY o.deposit_next_check_at ASC LIMIT $1`,
    [capped]
  )
  return result.rows.map(mapRow)
}

/**
 * Órdenes ACTIVAS (pending + verifying) de un pagador concreto: alimenta el
 * manejo del mensaje de confirmación de pago («ya pagué») en el canal
 * WhatsApp — responde el estado real (verifying) o pide el comprobante
 * (pending). Sin orden ligada al teléfono el turno sigue su curso normal.
 */
export async function findActivePaymentOrdersByPayerPhone(
  phone: string
): Promise<PaymentOrder[]> {
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.payer_phone = $1 AND o.status IN ('pending','verifying')
      ORDER BY o.created_at DESC`,
    [phone]
  )
  return result.rows.map(mapRow)
}

/**
 * Retardo del recordatorio proactivo desde el contacto del pagador: los
 * pagadores reales pagan en los primeros minutos (casos PLJ7/6HMR: 4 min);
 * a los 10 min sin comprobante la confirmación no llegó y el recordatorio
 * cierra el ciclo antes de que el pagador cierre el chat y desaparezca.
 */
export const PAYER_NUDGE_DELAY_MS = 10 * 60_000

/**
 * Cola del RECORDATORIO al pagador: links pendientes cuyo pagador contactó
 * (teléfono ligado), hace 10+ min, SIN comprobante recibido (nunca escaneó)
 * y sin recordatorio previo. UN solo aviso por orden (dedupe por
 * `payer_nudged_at`): nunca spam.
 */
export async function listDuePayerNudgeOrders(limit = 10): Promise<PaymentOrder[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 20)
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.status = 'pending' AND o.payer_phone IS NOT NULL
        AND o.payer_nudged_at IS NULL AND o.scan_status IS NULL
        AND o.payer_bound_at <= now() - ($2::int * interval '1 second')
      ORDER BY o.payer_bound_at ASC LIMIT $1`,
    [capped, Math.round(PAYER_NUDGE_DELAY_MS / 1000)]
  )
  return result.rows.map(mapRow)
}

/** Marca el recordatorio como enviado (claim: una sola vez por orden). */
export async function markPaymentOrderPayerNudged(orderId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET payer_nudged_at = now(), updated_at = now()
      WHERE id = $1::uuid AND payer_nudged_at IS NULL
      RETURNING id`,
    [orderId]
  )
  return (result.rowCount ?? 0) > 0
}

export interface DepositSweeperAccount {
  /** null = cuenta de plataforma (admins sin token propio). */
  sellerUserId: string | null
  /** Órdenes 'verifying' que esperan depósito en esta cuenta. */
  orders: number
}

/**
 * Cuentas receptoras con órdenes 'verifying' esperando depósito: es la
 * puerta del BARRIDO POR DEPÓSITO del verificador — UNA búsqueda de MP por
 * cuenta y tick cubre TODAS sus órdenes a la vez (latencia de reacción =
 * fase del tick, presupuesto constante independiente del número de
 * órdenes). Admins con token propio agrupan bajo SU usuario; admins sin
 * token bajo la plataforma (`null`); distribuidores sin token quedan
 * agrupados bajo su usuario pero sin token consultable (el barrido los
 * salta: su verificación es manual por diseño). Las órdenes 'pending' NO
 * participan: sin comprobante validado no hay identificación por código y
 * su depósito jamás se autoconfirma (resolución manual del creador).
 */
export async function listDepositSweeperAccounts(): Promise<
  DepositSweeperAccount[]
> {
  // Lista de trabajo cross-tenant del barrido (§4.2): el verificador barre
  // depósitos de TODAS las cuentas receptoras; systemPool, no RLS.
  const result = await systemPool.query<{
    seller_user_id: string | null
    n: number
  }>(
    `SELECT
       CASE WHEN u.role = 'admin' AND NOT EXISTS (
              SELECT 1 FROM user_mp_tokens t
               WHERE t.user_id = o.creator_user_id AND t.status = 'active'
            ) THEN NULL ELSE o.creator_user_id::text END AS seller_user_id,
       count(*)::int AS n
       FROM payment_orders o
       JOIN users u ON u.id = o.creator_user_id
      WHERE o.status = 'verifying'
        AND o.created_at >= now() - interval '72 hours'
      GROUP BY 1`
  )
  return result.rows.map((row) => ({
    sellerUserId:
      row.seller_user_id === null ? null : String(row.seller_user_id),
    orders: Number(row.n ?? 0),
  }))
}

/**
 * Candidatas del match DEPOSIT-SIDE (barrido del verificador y rama
 * webhook): SOLO órdenes 'verifying' (comprobante ya validado con el código
 * impreso — la identificación por código es mandatoria) de un importe
 * exacto cuyo dinero apunta a la cuenta receptora del depósito —
 * `sellerUserId = null` son los admins SIN token propio (su cuenta es la
 * plataforma, la que lee el token del `.env`); un usuario concreto es el
 * dueño de la credencial con que se leyó el depósito (distribuidor o admin
 * con token propio). Un depósito de una cuenta jamás confirma el link de
 * otra. La ventana se decide después (predicado puro
 * `depositWithinOrderWindow`); la reserva cruzada del depósito es la guarda
 * final dentro del candado del claim.
 */
export async function listDepositClaimantPaymentOrders(
  amountMxn: number,
  sellerUserId: string | null,
  limit = 50
): Promise<PaymentOrder[]> {
  const amount = Math.round(amountMxn * 100) / 100
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 200)
  const sellerFilter =
    sellerUserId === null
      ? `EXISTS (
          SELECT 1 FROM users u2
           WHERE u2.id = o.creator_user_id
             AND u2.role = 'admin'
             AND NOT EXISTS (
               SELECT 1 FROM user_mp_tokens t
                WHERE t.user_id = u2.id AND t.status = 'active'
             )
         )`
      : `o.creator_user_id = $3::uuid`
  // Lista de trabajo cross-tenant del match deposit-side (§4.2).
  const result = await systemPool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.status = 'verifying' AND o.amount_mxn = $1::numeric
        AND ${sellerFilter}
      ORDER BY o.created_at ASC LIMIT $2`,
    sellerUserId === null ? [amount, capped] : [amount, capped, sellerUserId]
  )
  return result.rows.map(mapRow)
}

/**
 * Registra el resultado de un sondeo sin hallazgo: incrementa el contador
 * (elige el tramo de backoff) y programa el siguiente intento. Solo toca
 * órdenes 'verifying' (el carril pending sin comprobante ya no existe).
 */
export async function savePaymentOrderDepositCheck(input: {
  orderId: string
  checks: number
  nextCheckAt: Date
}): Promise<void> {
  const result = await pool.query(
    `UPDATE payment_orders
        SET deposit_checks = $2, deposit_next_check_at = $3, updated_at = now()
      WHERE id = $1::uuid AND status = 'verifying'`,
    [input.orderId, input.checks, input.nextCheckAt]
  )
  if ((result.rowCount ?? 0) > 0) notifyPaymentOrderChange(input.orderId)
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
  const escalated = (result.rowCount ?? 0) > 0
  if (escalated) notifyPaymentOrderChange(orderId)
  return escalated
}

/**
 * Confirmación atómica del depósito: reclama la orden 'verifying' (SIEMPRE
 * con comprobante validado por el escaneo — la identificación del pagador
 * por el código de concepto impreso es mandatoria, no hay confirmación sin
 * comprobante) y la resuelve `paid` reservando el ID del pago de MP. La
 * exclusividad es CRUZADA con las renovaciones (`mp_orders` — ambos flujos
 * leen la misma cuenta): el advisory lock por ID de pago serializa a los
 * dos reclamantes y `isMpDepositClaimed` re-verifica DENTRO del candado
 * (los índices únicos de cada tabla no se ven entre sí). `reviewedBy` es el
 * propio creador (aprobación automática con quién). Null = otro actor ganó
 * el depósito o la orden.
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
    await setTenantContextInTx(tx)
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
        WHERE id = $1::uuid AND status = 'verifying'
              AND mp_payment_id IS NULL
        RETURNING id`,
      [input.orderId, input.mpPaymentId, input.mpDepositAt, input.reviewedBy]
    )
    if ((result.rowCount ?? 0) === 0) {
      await tx.query("ROLLBACK").catch(() => {})
      return null
    }
    await tx.query("COMMIT")
    notifyPaymentOrderChange(input.orderId)
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
 * Anclas de conciliación (concepto de pago, o el código en las órdenes de la
 * era previa) de las órdenes de pago ligadas a IDs de pagos de MP (columna
 * «Concepto» del reporte SPEI): el link es DETERMINISTA (el depósito que
 * confirmó la orden), no una inferencia por ventana. La conciliación vive
 * contra la PALABRA del concepto de pago; el código queda como respaldo de
 * las órdenes creadas antes de que la palabra fuera obligatoria.
 */
export async function findPaymentOrdersByMpPaymentIds(
  mpPaymentIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(mpPaymentIds.filter((id) => id.length > 0))]
  const result = new Map<string, string>()
  if (ids.length === 0) return result
  const rows = await pool.query<{
    id: string
    mp_payment_id: string
    code: string
    note: string | null
  }>(
    `SELECT id::text, mp_payment_id, code, note
       FROM payment_orders
      WHERE mp_payment_id = ANY($1)`,
    [ids]
  )
  for (const row of rows.rows) {
    result.set(
      String(row.mp_payment_id),
      paymentOrderConceptAnchor({ note: row.note, code: String(row.code) })
    )
  }
  return result
}

/**
 * Última orden RESUELTA cuyo CONCEPTO DE PAGO matchee cualquiera de las
 * palabras dadas (ya normalizadas por el llamador; la más recientemente
 * resuelta). Replay honesto del comprobante/código de una orden de palabra
 * ya resuelta — espejo de `findResolvedPaymentOrderByAnyCode`.
 */
export async function findResolvedPaymentOrderByAnyConcepto(
  words: string[]
): Promise<PaymentOrder | null> {
  const normalized = [
    ...new Set(
      words.map((word) => word.trim().toUpperCase()).filter((word) => word.length > 0)
    ),
  ]
  if (normalized.length === 0) return null
  const result = await pool.query<Record<string, unknown>>(
    `${SELECT_COLUMNS}
      WHERE o.note = ANY($1) AND o.status IN ('paid','rejected','cancelled')
      ORDER BY o.resolved_at DESC NULLS LAST LIMIT 1`,
    [normalized]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}
