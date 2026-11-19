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

/**
 * true si `code` (ya normalizado a mayúsculas) tiene la FORMA de un código de
 * concepto: 4 caracteres del alfabeto (sin 0/O/1/I). Única fuente de la
 * forma; la usa el Asistente para interceptar el mensaje del comprobante sin
 * secuestrar texto normal del chat («HOLA» no puede ser un código real).
 */
export function isTransferConceptCodeShape(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false
  return [...code].every((char) => CODE_ALPHABET.includes(char))
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

/** Concepto activo visto desde el chat: código + usuario al que está ligado. */
export interface ActiveConceptByCode extends TransferConcept {
  /** Usuario de FlujoTV que la orden renovará (ligado al emitir el código). */
  userName: string
  /** Cuenta que emitió el código (para validar que la orden la use). */
  buyerUserId: string
}

/**
 * TODOS los conceptos activos del comprador en el mes actual, del más viejo
 * al más nuevo. Es la base del descubrimiento del Asistente: el código
 * IMPRESO en el comprobante se busca entre estos conceptos para identificar
 * a qué orden pertenece el pago (sin pedirle el código al comprador).
 */
export async function findActiveConceptsForBuyer(input: {
  buyerUserId: string
}): Promise<ActiveConceptByCode[]> {
  const result = await pool.query<{
    id: string
    code: string
    period_month: string
    user_name: string
    buyer_user_id: string
  }>(
    `SELECT id, code, period_month, user_name, buyer_user_id
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND period_month = $2 AND status = 'active'
      ORDER BY created_at ASC`,
    [input.buyerUserId, currentPeriodMonth()]
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    periodMonth: String(row.period_month),
    userName: String(row.user_name),
    buyerUserId: String(row.buyer_user_id),
  }))
}

/**
 * Conceptos activos del mes acotados a UNOS USUARIOS concretos (sin filtro de
 * comprador: en el descubrimiento del flujo de clientes el comprador aún no
 * se resolvió — el buyer de cada concepto viaja en el resultado para que el
 * llamador valide que la orden lo use). Es el scoping del flujo de clientes
 * por WhatsApp: el comprobante que manda un cliente solo puede descubrir
 * conceptos de SUS licencias — nunca el de otro cliente del mismo
 * distribuidor.
 */
export async function findActiveConceptsForBuyerUsers(input: {
  userNames: string[]
}): Promise<ActiveConceptByCode[]> {
  const keys = [
    ...new Set(
      input.userNames
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0)
    ),
  ]
  if (keys.length === 0) return []
  const result = await pool.query<{
    id: string
    code: string
    period_month: string
    user_name: string
    buyer_user_id: string
  }>(
    `SELECT id, code, period_month, user_name, buyer_user_id
       FROM transfer_concepts
      WHERE period_month = $1 AND status = 'active'
        AND user_name = ANY($2::text[])
      ORDER BY created_at ASC`,
    [currentPeriodMonth(), keys]
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    periodMonth: String(row.period_month),
    userName: String(row.user_name),
    buyerUserId: String(row.buyer_user_id),
  }))
}

/** Concepto consumido visto desde el chat, con la orden que lo anuló. */
export interface ConsumedConceptByCode {
  code: string
  orderId: string
}

/**
 * Conceptos YA consumidos del comprador en el mes actual (con la orden que
 * los consumió). Alimenta el replay del Asistente: si el código impreso en
 * el comprobante ya fue usado, el comprador ve el estado REAL de esa orden
 * en lugar de un «concepto inválido» que invita a pagar dos veces.
 */
export async function findConsumedConceptsForBuyer(input: {
  buyerUserId: string
}): Promise<ConsumedConceptByCode[]> {
  const result = await pool.query<{
    code: string
    consumed_by_order_id: string
  }>(
    `SELECT code, consumed_by_order_id
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND period_month = $2
        AND status = 'consumed' AND consumed_by_order_id IS NOT NULL
      ORDER BY consumed_at DESC`,
    [input.buyerUserId, currentPeriodMonth()]
  )
  return result.rows.map((row) => ({
    code: String(row.code),
    orderId: String(row.consumed_by_order_id),
  }))
}

/**
 * Conceptos YA consumidos del mes acotados a unos usuarios (misma variante
 * filtrada de `findActiveConceptsForBuyerUsers` para el replay del flujo de
 * clientes: reenviar un comprobante ya usado responde el estado REAL de esa
 * orden solo si el código pertenece a las licencias del teléfono).
 */
export async function findConsumedConceptsForBuyerUsers(input: {
  userNames: string[]
}): Promise<ConsumedConceptByCode[]> {
  const keys = [
    ...new Set(
      input.userNames
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0)
    ),
  ]
  if (keys.length === 0) return []
  const result = await pool.query<{
    code: string
    consumed_by_order_id: string
  }>(
    `SELECT code, consumed_by_order_id
       FROM transfer_concepts
      WHERE period_month = $1 AND status = 'consumed'
        AND consumed_by_order_id IS NOT NULL
        AND user_name = ANY($2::text[])
      ORDER BY consumed_at DESC`,
    [currentPeriodMonth(), keys]
  )
  return result.rows.map((row) => ({
    code: String(row.code),
    orderId: String(row.consumed_by_order_id),
  }))
}

/**
 * Resuelve el concepto ACTIVO del comprador por SU código, sin el usuario:
 * es la puerta del envío de comprobante por el Asistente, donde el comprador
 * adjunta el ticket con el código como mensaje (el concepto ya quedó ligado
 * al usuario al emitirse en el paso 1). El código es único entre los activos
 * del mes a través de todos los compradores, así que (comprador, código)
 * identifica una sola intención. Null = código ajeno, vencido o anulado.
 */
export async function findActiveConceptByCodeForBuyer(input: {
  buyerUserId: string
  code: string
}): Promise<ActiveConceptByCode | null> {
  const periodMonth = currentPeriodMonth()
  const result = await pool.query<{
    id: string
    code: string
    period_month: string
    user_name: string
    buyer_user_id: string
  }>(
    `SELECT id, code, period_month, user_name, buyer_user_id
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND code = $2
        AND period_month = $3 AND status = 'active'
      LIMIT 1`,
    [input.buyerUserId, input.code.toUpperCase(), periodMonth]
  )
  const row = result.rows[0]
  return row
    ? {
        id: String(row.id),
        code: String(row.code),
        periodMonth: String(row.period_month),
        userName: String(row.user_name),
        buyerUserId: String(row.buyer_user_id),
      }
    : null
}

/**
 * Resuelve un código YA consumido del comprador a la orden que lo consumió,
 * por código sin usuario (misma puerta del Asistente que
 * `findActiveConceptByCodeForBuyer`). Alimenta la respuesta de replay: el
 * comprador que vuelve a mandar el código tras una respuesta perdida ve el
 * estado REAL de su orden, no un «código inválido» que invita a pagar dos
 * veces. Null = el código no existe, es ajeno o venció con el mes.
 */
export async function findConsumedConceptByCodeForBuyer(input: {
  buyerUserId: string
  code: string
}): Promise<ConsumedTransferConcept | null> {
  const periodMonth = currentPeriodMonth()
  const result = await pool.query<{
    id: string
    consumed_by_order_id: string | null
    period_month: string
  }>(
    `SELECT id, consumed_by_order_id, period_month
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND code = $2
        AND period_month = $3 AND status = 'consumed'
      LIMIT 1`,
    [input.buyerUserId, input.code.toUpperCase(), periodMonth]
  )
  const row = result.rows[0]
  if (!row || !row.consumed_by_order_id) return null
  return {
    conceptId: String(row.id),
    orderId: String(row.consumed_by_order_id),
    periodMonth: String(row.period_month),
  }
}

/** Concepto consumido con la orden que lo consumió (para el replay). */
export interface ConsumedTransferConcept {
  conceptId: string
  /** Orden que lo consumió (aprobada o rechazada); nunca de otro comprador. */
  orderId: string
  periodMonth: string
}

/**
 * Resuelve un código YA consumido del comprador + usuario + mes actual a la
 * orden que lo consumió. Es la mitad de la idempotencia del envío: el
 * comprador que reintenta la subida de su comprobante después de una
 * respuesta perdida no recibe «concepto inválido» (un callejón que invita a
 * pagar dos veces) sino el estado REAL de su orden anterior. Null = el
 * código no existe, es ajeno o venció con el mes: el 422 de siempre.
 */
export async function resolveConsumedTransferConcept(input: {
  buyerUserId: string
  userName: string
  code: string
}): Promise<ConsumedTransferConcept | null> {
  const periodMonth = currentPeriodMonth()
  const result = await pool.query<{
    id: string
    consumed_by_order_id: string | null
    period_month: string
  }>(
    `SELECT id, consumed_by_order_id, period_month
       FROM transfer_concepts
      WHERE buyer_user_id = $1::uuid AND user_name = $2
        AND code = $3 AND period_month = $4 AND status = 'consumed'
      LIMIT 1`,
    [input.buyerUserId, input.userName.trim(), input.code.toUpperCase(), periodMonth]
  )
  const row = result.rows[0]
  if (!row || !row.consumed_by_order_id) return null
  return {
    conceptId: String(row.id),
    orderId: String(row.consumed_by_order_id),
    periodMonth: String(row.period_month),
  }
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

/* ------------------------------------------------------------------------ */
/*         Conciliación con depósitos SPEI (reporte /modulos/reporte-spei)   */
/* ------------------------------------------------------------------------ */

/**
 * Tolerancia para casar el instante del depósito acreditado con la ventana
 * del concepto: el reloj del banco que originó la transferencia y el del
 * servidor no coinciden, y el comprobante se aprueba ~1 min después de la
 * acreditación (caso real: depósito 22:19:53, orden aprobada 22:20:52).
 */
const DEPOSIT_MATCH_TOLERANCE_MS = 120_000

/** Casado depósito → concepto para la columna «Concepto» del reporte SPEI. */
export interface DepositConceptMatch {
  /**
   * Código(s) de concepto; varios unidos con «·» cuando el casado es
   * ambiguo (más de un concepto calza con el mismo depósito).
   */
  code: string
  /** Cliente FlujoTV si todos los coincidentes comparten uno; null si difieren. */
  userName: string | null
  /** true si más de un concepto calza con el depósito. */
  ambiguous: boolean
}

interface ConceptCandidate {
  code: string
  userName: string
  /** Ventana cerrada [creado, consumido] en ms de época, ya con tolerancia. */
  startMs: number
  endMs: number
  /** Importe de la orden ligada (`mp_orders.concept_id`); null si no hay. */
  amount: number | null
}

function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}

/**
 * Cruza depósitos acreditados con conceptos de pago para la tabla del
 * reporte SPEI. Mercado Pago NO expone el concepto escrito por el pagador
 * (verificado en el payload de `/v1/payments`: el código impreso no viaja),
 * así que el casado es por ventana de tiempo e importe contra los conceptos
 * CONSUMIDOS únicamente:
 *
 *   - Ventana cerrada del concepto: desde su emisión (`created_at`, el
 *     comprador lo recibe ANTES de transferir) hasta su anulación
 *     (`consumed_at`, la orden se aprueba/rechaza DESPUÉS de la
 *     acreditación del dinero). Los conceptos aún activos NO participan:
 *     su ventana abierta reclamaría cualquier depósito posterior (caso
 *     real: 9 códigos latentes por depósito) y solo la subida del
 *     comprobante confirma a qué dinero corresponde; al consumirse, el
 *     reporte lo muestra tras refrescar.
 *   - El importe es OBLIGATORIO: el depósito debe coincidir con el de la
 *     orden ligada (`mp_orders.concept_id`). Sin coincidencia por importe
 *     el depósito queda «—» aunque la ventana calce — las ventanas de un
 *     día con varios pagos se traslapan y el fallback «solo ventana»
 *     ligaba depósitos ajenos al concepto (caso real: cargas propias de
 *     $10 y $60.07 quedaron pintadas como el concepto de $100 del día).
 *     >1 coincidencia por importe es ambiguo y se muestran todos los
 *     códigos.
 */
export async function resolveConceptsForDeposits(input: {
  windowStartIso: string
  windowEndIso: string
  deposits: { id: string; atIso: string | null; amountMxn: number }[]
  /**
   * Acota los conceptos a los emitidos por ESTE comprador: el reporte de una
   * credencial propia (distribuidor) solo casa depósitos de SU cuenta con
   * SUS conceptos. Ausente = conceptos de todos los compradores (reporte de
   * plataforma, cuenta única del admin).
   */
  buyerUserId?: string
}): Promise<Map<string, DepositConceptMatch>> {
  const matches = new Map<string, DepositConceptMatch>()
  if (input.deposits.length === 0) return matches

  const createdBefore = new Date(
    Date.parse(input.windowEndIso) + DEPOSIT_MATCH_TOLERANCE_MS
  )
  const consumedAfter = new Date(
    Date.parse(input.windowStartIso) - DEPOSIT_MATCH_TOLERANCE_MS
  )

  const result = await pool.query<{
    id: string
    code: string
    user_name: string
    created_at: Date
    consumed_at: Date
    bound_amount: string | number | null
  }>(
    `SELECT c.id, c.code, c.user_name, c.created_at, c.consumed_at,
            bound.amount AS bound_amount
       FROM transfer_concepts c
       LEFT JOIN LATERAL (
         SELECT o.amount
           FROM mp_orders o
          WHERE o.concept_id = c.id
          ORDER BY o.created_at DESC
          LIMIT 1
       ) bound ON true
      WHERE c.status = 'consumed' AND c.consumed_at IS NOT NULL
        AND c.created_at <= $1::timestamptz
        AND c.consumed_at >= $2::timestamptz
        AND ($3::uuid IS NULL OR c.buyer_user_id = $3::uuid)`,
    [createdBefore, consumedAfter, input.buyerUserId ?? null]
  )

  const candidates: ConceptCandidate[] = result.rows.map((row) => {
    const rawAmount = row.bound_amount
    const bound = rawAmount === null || rawAmount === undefined ? null : Number(rawAmount)
    return {
      code: String(row.code),
      userName: String(row.user_name),
      startMs: new Date(row.created_at).getTime() - DEPOSIT_MATCH_TOLERANCE_MS,
      endMs: new Date(row.consumed_at).getTime() + DEPOSIT_MATCH_TOLERANCE_MS,
      amount: Number.isFinite(bound) ? bound : null,
    }
  })

  for (const deposit of input.deposits) {
    if (!deposit.atIso) continue
    const atMs = Date.parse(deposit.atIso)
    if (Number.isNaN(atMs)) continue
    const matched = candidates.filter(
      (candidate) =>
        atMs >= candidate.startMs &&
        atMs <= candidate.endMs &&
        candidate.amount !== null &&
        amountsEqual(candidate.amount, deposit.amountMxn)
    )
    if (matched.length === 0) continue
    const names = [...new Set(matched.map((candidate) => candidate.userName))]
    const codes = [...new Set(matched.map((candidate) => candidate.code))]
    matches.set(deposit.id, {
      code: codes.join(" · "),
      userName: names.length === 1 ? names[0] : null,
      ambiguous: matched.length > 1,
    })
  }

  return matches
}
