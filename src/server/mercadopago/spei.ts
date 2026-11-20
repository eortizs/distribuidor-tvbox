import { mercadoPagoGatewayRequest, mercadoPagoRequestAs } from "./client"
import { MercadoPagoError } from "./errors"
import { resolveConceptsForDeposits } from "@/server/transferencias/concepto"
import { findPaymentOrdersByMpPaymentIds } from "@/server/links-pago/repository"

/**
 * Reporte SPEI (`/modulos/reporte-spei`): depósitos por transferencia
 * ACREDITADOS en la cuenta de Mercado Pago del vendedor, para el día actual
 * o un día específico, en DOS RIELES: SPEI a la CLABE (`clabe`/
 * `bank_transfer` con `operation_type = account_fund`) y transferencia desde
 * el saldo de otra cuenta MP (`operation_type = money_transfer`; la mayoría
 * de las renovaciones reales llega por aquí). Consulta viva a
 * `GET /v1/payments/search` — no hay registro en BD: lo acreditado en MP es
 * la verdad y la API cubre días anteriores sin límite práctico.
 *
 * Ninguno de los dos rieles tiene un filtro dedicado en la API: el filtro de
 * operación se aplica aquí, en backend, sobre los resultados de cada
 * consulta. El riel billetera solo contiene ENTRADAS (verificado en el
 * histórico: los gastos con saldo y las compras llegan como
 * `regular_payment`, no como `money_transfer`).
 */

/** Cargas de saldo SPEI (CLABE) confirmadas y acreditadas. */
const SPEI_OPERATION_TYPE = "account_fund"

/** Transferencias desde el saldo de otra cuenta MP (billetera → cuenta). */
const WALLET_OPERATION_TYPE = "money_transfer"

/** Riel de entrada de un depósito del reporte. */
export type SpeiDepositRail = "spei" | "wallet"

/** Página de `payments/search` y tope defensivo (20 páginas = 1000 pagos). */
const PAGE_LIMIT = 50
const PAGE_MAX = 20

/**
 * Presupuesto total de las consultas paginadas (COMPARTIDO entre los dos
 * rieles) y timeout por página: MP suele responder en 1-2 s, así que un MP
 * degradado corta por presupuesto antes de agotar el request (~100 s de
 * Cloudflare; el peor caso acotado es presupuesto + una página por riel) y
 * lo que alcanzó a leer sale marcado `truncated` en vez de colgar el módulo.
 * La ventana del verificador de órdenes de pago usa presupuesto y tope de
 * páginas propios (ventana corta, pocas páginas bastan).
 */
const QUERY_BUDGET_MS = 45_000
const PAGE_TIMEOUT_MS = 10_000
const WINDOW_BUDGET_MS = 15_000
const WINDOW_PAGE_MAX = 2

/** Zona horaria de negocio del panel (México, sin DST desde 2022). */
const SPEI_TZ = "America/Mexico_City"

export interface SpeiDepositRow {
  /** ID del pago en Mercado Pago. */
  id: string
  /** Fecha/hora de acreditación (ISO crudo de MP, ya acotado al día CDMX). */
  dateApproved: string | null
  /** Monto depositado (transaction_amount), en MXN. */
  amountMxn: number
  /** Neto recibido si MP lo reporta; null si no viene. */
  netAmountMxn: number | null
  /** Riel de entrada: SPEI a la CLABE o billetera de otra cuenta MP. */
  rail: SpeiDepositRail
  /** Nombre del pagador si MP lo devuelve (en account_fund a veces falta). */
  payerName: string | null
  /** Correo del pagador si MP lo devuelve. */
  payerEmail: string | null
  /** Referencia externa si el depósito la trajo (no es lo usual). */
  externalReference: string | null
  /**
   * Concepto de pago resuelto contra `transfer_concepts` (MP no expone el
   * concepto escrito por el pagador): código único o varios unidos con «·»
   * cuando el casado es ambiguo. null = sin coincidencia.
   */
  conceptCode: string | null
  /** Cliente FlujoTV del concepto, si todos los coincidentes comparten uno. */
  conceptUserName: string | null
  /** true si más de un concepto calza con el depósito. */
  conceptAmbiguous: boolean
}

export interface SpeiDayReport {
  /** Día reportado, `YYYY-MM-DD` en America/Mexico_City. */
  day: string
  deposits: SpeiDepositRow[]
  count: number
  /** Suma de `amountMxn` del día, redondeada a 2 decimales. */
  totalMxn: number
  /** True si se alcanzó el tope defensivo de páginas (datos parciales). */
  truncated: boolean
}

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

/* -------------------------------------------------------------------------- */
/*                 Día calendario en America/Mexico_City → ISO                 */
/* -------------------------------------------------------------------------- */

/** True si `value` tiene forma `YYYY-MM-DD` (día calendario válido). */
export function isValidSpeiDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ts = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ts)) return false
  return new Date(ts).toISOString().slice(0, 10) === value
}

/** Minutos de desfase UTC de `timeZone` en el instante dado (via Intl). */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts = new Map(
    dtf.formatToParts(instant).map((part) => [part.type, part.value])
  )
  const asUtc = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")),
    Number(parts.get("minute")),
    Number(parts.get("second"))
  )
  return Math.round((asUtc - instant.getTime()) / 60000)
}

/** Instante UTC (ms) de la medianoche local de `day` en `timeZone`. */
function localDayStartUtcMs(day: string, timeZone: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`)
  return guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000
}

/** ISO 8601 con el offset real de la zona en ese instante (p. ej. -06:00). */
function isoWithOffset(utcMs: number, offsetMinutes: number): string {
  const base = new Date(utcMs + offsetMinutes * 60000)
    .toISOString()
    .slice(0, 23)
  const sign = offsetMinutes < 0 ? "-" : "+"
  const abs = Math.abs(offsetMinutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, "0")
  const mm = String(abs % 60).padStart(2, "0")
  return `${base}${sign}${hh}:${mm}`
}

/** Rango [inicio, fin) del día calendario en CDMX como ISO con offset. */
export function cdmxDayRange(day: string): { beginIso: string; endIso: string } {
  const startMs = localDayStartUtcMs(day, SPEI_TZ)
  const startOffset = tzOffsetMinutes(new Date(startMs), SPEI_TZ)
  const endMs = localDayStartUtcMs(nextDay(day), SPEI_TZ)
  const endOffset = tzOffsetMinutes(new Date(endMs), SPEI_TZ)
  return {
    beginIso: isoWithOffset(startMs, startOffset),
    endIso: isoWithOffset(endMs, endOffset),
  }
}

/** Día siguiente en formato `YYYY-MM-DD` (aritmética en UTC, sin sorpresas). */
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** Hoy en CDMX como `YYYY-MM-DD` (el reloj del servidor puede ir en UTC). */
export function cdmxToday(): string {
  const now = new Date()
  const offsetMinutes = tzOffsetMinutes(now, SPEI_TZ)
  return new Date(now.getTime() + offsetMinutes * 60000)
    .toISOString()
    .slice(0, 10)
}

/** True si `MERCADOPAGO_ACCESS_TOKEN` está presente (para degradar la UI). */
export function speiReportConfigured(): boolean {
  return (process.env.MERCADOPAGO_ACCESS_TOKEN?.trim().length ?? 0) > 0
}

/* -------------------------------------------------------------------------- */
/*                    Consulta paginada a /v1/payments/search                  */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function isSpeiLoad(payment: Record<string, unknown>): boolean {
  return payment.operation_type === SPEI_OPERATION_TYPE
}

function isWalletLoad(payment: Record<string, unknown>): boolean {
  return payment.operation_type === WALLET_OPERATION_TYPE
}

function toDepositRow(
  payment: Record<string, unknown>,
  rail: SpeiDepositRail
): SpeiDepositRow {
  const payer = isRecord(payment.payer) ? payment.payer : {}
  const firstName = stringOrNull(payer.first_name)
  const lastName = stringOrNull(payer.last_name)
  const payerName =
    firstName !== null && lastName !== null
      ? `${firstName} ${lastName}`
      : (firstName ?? lastName)
  return {
    id: String(payment.id ?? ""),
    dateApproved: stringOrNull(payment.date_approved),
    amountMxn: numberOrNull(payment.transaction_amount) ?? 0,
    netAmountMxn: numberOrNull(payment.net_received_amount),
    rail,
    payerName,
    payerEmail: stringOrNull(payer.email),
    externalReference: stringOrNull(payment.external_reference),
    conceptCode: null,
    conceptUserName: null,
    conceptAmbiguous: false,
  }
}

interface SearchPage {
  results: unknown[]
}

interface DepositSearch {
  deposits: SpeiDepositRow[]
  truncated: boolean
  pages: number
}

/**
 * Núcleo de consulta compartido: depósitos ACREDITADOS en los dos rieles de
 * entrada (SPEI a la CLABE + transferencia desde saldo de otra cuenta MP),
 * `status=approved`/`status_detail=accredited`, acotados por `date_approved`
 * en ISO con offset real, con paginación hasta `maxPagesPerRail`, presupuesto
 * compartido `budgetMs`, dedupe por ID y orden final según `criteria`. Sirve
 * tanto al reporte del día (desc) como a la ventana del verificador de
 * órdenes de pago (asc: el depósito buscado está cerca del INICIO de la
 * ventana, así que la paginación ascendente lo deja en la página 1).
 */
async function searchAccreditedDeposits(input: {
  beginIso: string
  endIso: string
  budgetMs: number
  maxPagesPerRail: number
  criteria?: "asc" | "desc"
  /** Timeout por página (el chequeo inmediato usa uno corto). */
  pageTimeoutMs?: number
  /**
   * Token EXPLÍCITO de la cuenta a consultar: la credencial propia de un
   * distribuidor (tabla `user_mp_tokens`). Ausente → cuenta de plataforma
   * (`MERCADOPAGO_ACCESS_TOKEN`), el comportamiento histórico.
   */
  accessToken?: string
}): Promise<DepositSearch> {
  const criteria = input.criteria ?? "desc"
  const baseQuery = {
    status: "approved",
    status_detail: "accredited",
    range: "date_approved",
    begin_date: input.beginIso,
    end_date: input.endIso,
    sort: "date_approved",
    criteria,
    limit: String(PAGE_LIMIT),
  }
  const rails: {
    query: URLSearchParams
    accept: (payment: Record<string, unknown>) => boolean
    rail: SpeiDepositRail
  }[] = [
    {
      query: new URLSearchParams({
        ...baseQuery,
        payment_method_id: "clabe",
        payment_type_id: "bank_transfer",
      }),
      accept: isSpeiLoad,
      rail: "spei",
    },
    {
      query: new URLSearchParams({
        ...baseQuery,
        operation_type: WALLET_OPERATION_TYPE,
      }),
      accept: isWalletLoad,
      rail: "wallet",
    },
  ]

  const deposits: SpeiDepositRow[] = []
  const seenIds = new Set<string>()
  let truncated = false
  let pages = 0
  const startedAt = Date.now()

  for (const rail of rails) {
    for (let page = 0; page < input.maxPagesPerRail; page += 1) {
      // El presupuesto se revisa antes de CADA página salvo la primera del
      // primer riel (si la primera de cada riel corriera siempre, el peor
      // caso serían dos timeouts completos — p. ej. el chequeo inmediato de
      // 8 s del turno de WhatsApp); el acotado queda en budgetMs + un
      // timeout de página.
      if (pages > 0 && Date.now() - startedAt > input.budgetMs) {
        truncated = true
        break
      }
      rail.query.set("offset", String(page * PAGE_LIMIT))
      const requestInit = {
        timeoutMs: input.pageTimeoutMs ?? PAGE_TIMEOUT_MS,
      }
      const response =
        input.accessToken !== undefined
          ? await mercadoPagoRequestAs<SearchPage>(
              input.accessToken,
              `/v1/payments/search?${rail.query.toString()}`,
              requestInit
            )
          : await mercadoPagoGatewayRequest<SearchPage>(
              `/v1/payments/search?${rail.query.toString()}`,
              requestInit
            )
      const results = Array.isArray(response.data?.results)
        ? response.data.results
        : []
      pages += 1

      for (const row of results) {
        if (!isRecord(row)) continue
        if (!rail.accept(row)) continue
        const deposit = toDepositRow(row, rail.rail)
        // Dedupe por ID: el feed está vivo y ordenado por fecha desc, y un
        // depósito acreditado a mitad de la paginación corre los offsets y
        // duplica la fila de la frontera — sin esto el total del día se infla.
        if (deposit.id.length === 0 || seenIds.has(deposit.id)) continue
        seenIds.add(deposit.id)
        deposits.push(deposit)
      }

      if (results.length < PAGE_LIMIT) break
      if (page === input.maxPagesPerRail - 1) truncated = true
    }
  }

  // Orden final según el criterio de la consulta (el reporte del día es
  // desc; la ventana del verificador es asc — el depósito buscado está
  // cerca del inicio de la ventana).
  const direction = criteria === "asc" ? 1 : -1
  deposits.sort((a, b) =>
    (a.dateApproved ?? "").localeCompare(b.dateApproved ?? "") * direction
  )

  return { deposits, truncated, pages }
}

/**
 * Depósitos acreditados en una VENTANA arbitraria (ISO con offset real) en
 * los dos rieles de entrada: es la fuente del verificador de órdenes de
 * pago — la orden se confirma cuando un depósito de importe exacto aparece
 * aquí dentro de su ventana. Ventana corta (desde la creación de la orden),
 * paginación ASCENDENTE (el depósito pagado justo tras crearse la orden
 * queda en la página 1 aunque la ventana crezca) y presupuesto menor que el
 * del reporte del día.
 */
export async function findDepositsForPaymentOrderWindow(input: {
  beginIso: string
  endIso: string
  /** Presupuesto propio (el default es el de ventana del verificador). */
  budgetMs?: number
  /** Timeout por página propio (el chequeo inmediato usa uno corto). */
  pageTimeoutMs?: number
  /** Token explícito de la cuenta receptora (credencial propia del dueño). */
  accessToken?: string
}): Promise<SpeiDepositRow[]> {
  const { deposits } = await searchAccreditedDeposits({
    beginIso: input.beginIso,
    endIso: input.endIso,
    budgetMs: input.budgetMs ?? WINDOW_BUDGET_MS,
    maxPagesPerRail: WINDOW_PAGE_MAX,
    criteria: "asc",
    pageTimeoutMs: input.pageTimeoutMs,
    accessToken: input.accessToken,
  })
  return deposits
}

/**
 * Depósitos acreditados del día indicado en CDMX en los dos rieles de
 * entrada: SPEI a la CLABE (`payment_method_id=clabe`,
 * `payment_type_id=bank_transfer`, `operation_type=account_fund`) y
 * transferencia desde el saldo de otra cuenta MP
 * (`operation_type=money_transfer`), ambos `status=approved`,
 * `status_detail=accredited` y acotados por `date_approved`, con paginación
 * hasta el tope defensivo, presupuesto compartido, dedupe por ID y orden
 * final por fecha desc.
 */
export async function listSpeiDepositsForDay(
  day: string,
  accessToken?: string,
  options?: {
    /**
     * Acota la columna «Concepto» a los conceptos emitidos por ESTE
     * comprador: en el reporte de una credencial propia (distribuidor) los
     * depósitos de su cuenta solo casan con SUS conceptos de pago, nunca con
     * los de otra cuenta (p. ej. los del admin).
     */
    conceptBuyerUserId?: string
  }
): Promise<SpeiDayReport> {
  if (!isValidSpeiDay(day)) {
    throw new MercadoPagoError(
      400,
      "fecha_invalida",
      "La fecha debe ser un día válido en formato YYYY-MM-DD."
    )
  }

  const { beginIso, endIso } = cdmxDayRange(day)
  const { deposits, truncated, pages } = await searchAccreditedDeposits({
    beginIso,
    endIso,
    budgetMs: QUERY_BUDGET_MS,
    maxPagesPerRail: PAGE_MAX,
    accessToken,
  })

  // Columna «Concepto»: cruza cada depósito con los conceptos de pago
  // emitidos (ventana de tiempo + importe) y con las órdenes de pago
  // confirmadas por depósito (link determinista por ID de MP). Mejor
  // esfuerzo: un fallo de BD deja la columna vacía sin romper el reporte.
  if (deposits.length > 0) {
    try {
      const matches = await resolveConceptsForDeposits({
        windowStartIso: beginIso,
        windowEndIso: endIso,
        deposits: deposits.map((deposit) => ({
          id: deposit.id,
          atIso: deposit.dateApproved,
          amountMxn: deposit.amountMxn,
        })),
        buyerUserId: options?.conceptBuyerUserId,
      })
      // El link por ID de pago de MP es determinista y GANA sobre la
      // inferencia por ventana de transfer_concepts.
      const orderCodes = await findPaymentOrdersByMpPaymentIds(
        deposits.map((deposit) => deposit.id)
      ).catch(() => new Map<string, string>())
      for (const deposit of deposits) {
        const orderCode = orderCodes.get(deposit.id)
        if (orderCode) {
          deposit.conceptCode = orderCode
          deposit.conceptUserName = null
          deposit.conceptAmbiguous = false
          continue
        }
        const match = matches.get(deposit.id)
        if (!match) continue
        deposit.conceptCode = match.code
        deposit.conceptUserName = match.userName
        deposit.conceptAmbiguous = match.ambiguous
      }
    } catch (error) {
      log("spei.concept_match_failed", {
        day,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const totalMxn =
    Math.round(
      deposits.reduce((sum, deposit) => sum + deposit.amountMxn, 0) * 100
    ) / 100

  log("spei.report", {
    day,
    own_token: accessToken !== undefined,
    count: deposits.length,
    total_mxn: totalMxn,
    spei: deposits.filter((deposit) => deposit.rail === "spei").length,
    wallet: deposits.filter((deposit) => deposit.rail === "wallet").length,
    pages,
    truncated,
  })

  return { day, deposits, count: deposits.length, totalMxn, truncated }
}
