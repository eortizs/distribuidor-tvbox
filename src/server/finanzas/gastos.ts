import { randomUUID } from "node:crypto"

import { fixRates, mxDayKey } from "@/server/banxico"
import { pool } from "@/server/db"
import { EXPENSE_CATEGORIES } from "@/lib/finanzas"
import { AppError } from "@/server/umejson/types"

/*
 * Expense tracking service. Every query is scoped by user_id: callers pass the
 * id of the authenticated session user and the SQL filters on it, so one user
 * can never read or mutate another user's expenses. Money is stored in the
 * currency it was paid in; USD rows freeze the Banxico FIX rate (and the MXN
 * equivalent) at registration so historical reports stay stable.
 */

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export type ExpenseCurrency = "MXN" | "USD"

export interface ExpenseRow {
  id: string
  userId: string
  description: string
  category: string
  amount: number
  currency: ExpenseCurrency
  exchangeRate: number | null
  mxnEquivalent: number | null
  spentOn: string
  notes: string | null
  createdBy: "user" | "asistente"
  createdAt: string
  updatedAt: string
}

export interface ExpenseInput {
  description: string
  category: string
  amount: number
  currency: ExpenseCurrency
  spentOn: string
  notes?: string | null
}

export interface ListExpensesParams {
  from?: string
  to?: string
  category?: string
  q?: string
  limit?: number
  offset?: number
}

export interface ListExpensesResult {
  items: ExpenseRow[]
  total: number
}

export interface ExpenseSummaryBucket {
  key: string
  count: number
  totalMxn: number
  usdPending: number
}

export interface ExpenseSummary {
  from: string
  to: string
  count: number
  totalMxn: number
  usdPending: number
  usdPendingCount: number
  byCategory: ExpenseSummaryBucket[]
  byMonth: ExpenseSummaryBucket[]
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MIN_DAY = "2000-01-01"
// App-level cap well below the column limits so even the worst-case USD
// conversion (amount × FIX rate) always fits mxn_equivalent numeric(14,2).
const MAX_AMOUNT = 9_999_999.99
const DEFAULT_LIMIT = 25

function finiteInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.trunc(value)
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toIso(value: Date | string | undefined | null): string {
  if (!value) return new Date().toISOString()
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function isValidDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}

function assertDay(day: string, field: string): string {
  if (!isValidDay(day)) {
    throw new AppError(
      422,
      "validation_error",
      `${field} debe ser una fecha válida en formato YYYY-MM-DD.`
    )
  }
  if (day < MIN_DAY) {
    throw new AppError(
      422,
      "validation_error",
      `${field} no puede ser anterior a ${MIN_DAY}.`
    )
  }
  // One day of tolerance for clock skew / "yesterday recorded early".
  const tomorrow = mxDayKey(new Date(Date.now() + 36 * 3_600_000))
  if (day > tomorrow) {
    throw new AppError(
      422,
      "validation_error",
      `${field} no puede estar en el futuro.`
    )
  }
  return day
}

function parseAmount(input: unknown): number {
  const value = typeof input === "string" ? Number(input.replace(/,/g, "")) : Number(input)
  if (!Number.isFinite(value)) {
    throw new AppError(
      422,
      "validation_error",
      "El monto debe ser un número válido."
    )
  }
  const rounded = round2(value)
  if (rounded <= 0) {
    throw new AppError(
      422,
      "validation_error",
      "El monto debe ser mayor a 0."
    )
  }
  if (rounded > MAX_AMOUNT) {
    throw new AppError(
      422,
      "validation_error",
      `El monto no puede exceder ${MAX_AMOUNT.toLocaleString("es-MX")}.`
    )
  }
  return rounded
}

function parseCurrency(input: unknown): ExpenseCurrency {
  if (input !== "MXN" && input !== "USD") {
    throw new AppError(
      422,
      "validation_error",
      "La moneda debe ser MXN o USD."
    )
  }
  return input
}

function parseCategory(input: unknown): ExpenseCategory {
  const value = typeof input === "string" ? input.trim() : ""
  const match = EXPENSE_CATEGORIES.find(
    (category) => category.toLowerCase() === value.toLowerCase()
  )
  if (!match) {
    throw new AppError(
      422,
      "validation_error",
      `Categoría inválida. Categorías permitidas: ${EXPENSE_CATEGORIES.join(", ")}.`
    )
  }
  return match
}

function parseDescription(input: unknown): string {
  const value = typeof input === "string" ? input.trim() : ""
  if (value.length < 1 || value.length > 300) {
    throw new AppError(
      422,
      "validation_error",
      "La descripción debe tener entre 1 y 300 caracteres."
    )
  }
  return value
}

function parseNotes(input: unknown): string | null {
  if (input === null || input === undefined) return null
  const value = String(input).trim()
  if (value.length === 0) return null
  if (value.length > 1000) {
    throw new AppError(
      422,
      "validation_error",
      "Las notas no pueden exceder 1000 caracteres."
    )
  }
  return value
}

function assertFilterDay(day: string | undefined, field: string): string | undefined {
  if (day === undefined || day === null || day === "") return undefined
  if (!isValidDay(day)) {
    throw new AppError(
      422,
      "validation_error",
      `${field} debe ser una fecha válida en formato YYYY-MM-DD.`
    )
  }
  return day
}

export function validateExpenseInput(input: Record<string, unknown>): ExpenseInput {
  return {
    description: parseDescription(input.description),
    category: parseCategory(input.category),
    amount: parseAmount(input.amount),
    currency: parseCurrency(input.currency),
    spentOn: assertDay(
      typeof input.spentOn === "string" ? input.spentOn : "",
      "La fecha del gasto"
    ),
    notes: parseNotes(input.notes),
  }
}

/*
 * Resolves the frozen conversion for a registration. MXN rows convert 1:1.
 * USD rows use the FIX rate published for the spent day (forward-filled by
 * the Banxico cache) and fall back to the latest published rate; when even
 * that is unavailable the row is stored without conversion and reports must
 * surface it as pending (degrade gracefully, never fail the registration).
 */
async function resolveMxnConversion(
  amount: number,
  currency: ExpenseCurrency,
  spentOn: string
): Promise<{ exchangeRate: number | null; mxnEquivalent: number | null }> {
  if (currency === "MXN") {
    return { exchangeRate: null, mxnEquivalent: round2(amount) }
  }
  const { rates, latest } = await fixRates([spentOn])
  const rate = rates.get(spentOn) ?? latest?.rate ?? null
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    return { exchangeRate: null, mxnEquivalent: null }
  }
  return { exchangeRate: rate, mxnEquivalent: round2(amount * rate) }
}

function mapExpenseRow(row: Record<string, unknown>): ExpenseRow {
  const currency = row.currency as ExpenseCurrency
  return {
    id: row.id as string,
    userId: row.user_id as string,
    description: row.description as string,
    category: row.category as string,
    amount: Number(row.amount),
    currency,
    exchangeRate: toNumber(row.exchange_rate),
    mxnEquivalent: toNumber(row.mxn_equivalent),
    spentOn: row.spent_on as string,
    notes: (row.notes as string | null) ?? null,
    createdBy: row.created_by as "user" | "asistente",
    createdAt: toIso(row.created_at as Date),
    updatedAt: toIso(row.updated_at as Date),
  }
}

const EXPENSE_COLUMNS = `id, user_id, description, category, amount, currency,
  exchange_rate, mxn_equivalent, spent_on::text AS spent_on, notes, created_by,
  created_at, updated_at`

export async function createExpense(
  userId: string,
  input: ExpenseInput,
  createdBy: "user" | "asistente" = "user"
): Promise<ExpenseRow> {
  const { exchangeRate, mxnEquivalent } = await resolveMxnConversion(
    input.amount,
    input.currency,
    input.spentOn
  )
  const result = await pool.query(
    `INSERT INTO expenses
       (id, user_id, description, category, amount, currency,
        exchange_rate, mxn_equivalent, spent_on, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${EXPENSE_COLUMNS}`,
    [
      randomUUID(),
      userId,
      input.description,
      input.category,
      input.amount.toFixed(2),
      input.currency,
      exchangeRate !== null ? exchangeRate.toFixed(6) : null,
      mxnEquivalent !== null ? mxnEquivalent.toFixed(2) : null,
      input.spentOn,
      input.notes,
      createdBy,
    ]
  )
  return mapExpenseRow(result.rows[0])
}

export interface SystemExpenseInput {
  userId: string
  sourceImageId: string
  description: string
  notes: string | null
  amount: number
  spentOn: string
  exchangeRate: number | null
  mxnEquivalent: number | null
}

/*
 * Mirrors an automatically-metered cost (image generation) into the expense
 * control. Amount and conversion come from the meter (tarificador), not from
 * user input, so no input validation runs here — only the unique
 * source_image_id guard, which makes repeats and backfills idempotent.
 */
export async function createSystemExpense(
  input: SystemExpenseInput
): Promise<ExpenseRow | null> {
  const amount = Math.round(input.amount * 1e6) / 1e6
  if (!(amount > 0)) return null
  const result = await pool.query(
    `INSERT INTO expenses
       (id, user_id, description, category, amount, currency,
        exchange_rate, mxn_equivalent, spent_on, notes, created_by, source_image_id)
     VALUES ($1, $2, $3, 'Imágenes', $4, 'USD', $5, $6, $7, $8, 'sistema', $9)
     ON CONFLICT (source_image_id) DO NOTHING
     RETURNING ${EXPENSE_COLUMNS}`,
    [
      randomUUID(),
      input.userId,
      input.description.slice(0, 300),
      amount.toFixed(6),
      input.exchangeRate !== null ? input.exchangeRate.toFixed(6) : null,
      input.mxnEquivalent !== null
        ? (Math.round(input.mxnEquivalent * 1e6) / 1e6).toFixed(6)
        : null,
      input.spentOn,
      input.notes,
      input.sourceImageId,
    ]
  )
  return result.rowCount === 0 ? null : mapExpenseRow(result.rows[0])
}

export async function getExpense(
  userId: string,
  id: string
): Promise<ExpenseRow> {
  const result = await pool.query(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  )
  if (result.rowCount === 0) {
    throw new AppError(404, "not_found", "El gasto no existe.")
  }
  return mapExpenseRow(result.rows[0])
}

export async function listExpenses(
  userId: string,
  params: ListExpensesParams = {}
): Promise<ListExpensesResult> {
  const limit = Math.min(
    Math.max(finiteInt(params.limit, DEFAULT_LIMIT), 1),
    100
  )
  const offset = Math.max(finiteInt(params.offset, 0), 0)
  const from = assertFilterDay(params.from, "La fecha inicial")
  const to = assertFilterDay(params.to, "La fecha final")
  if (from && to && from > to) {
    throw new AppError(
      422,
      "validation_error",
      "La fecha inicial no puede ser posterior a la fecha final."
    )
  }

  const conditions = ["user_id = $1", "deleted_at IS NULL"]
  const values: unknown[] = [userId]
  if (from) {
    values.push(from)
    conditions.push(`spent_on >= $${values.length}`)
  }
  if (to) {
    values.push(to)
    conditions.push(`spent_on <= $${values.length}`)
  }
  if (params.category) {
    values.push(parseCategory(params.category))
    conditions.push(`category = $${values.length}`)
  }
  if (params.q) {
    const escaped = params.q.replace(/[\\%_]/g, (match) => `\\${match}`)
    values.push(`%${escaped}%`)
    conditions.push(
      `(description ILIKE $${values.length} OR notes ILIKE $${values.length})`
    )
  }

  const result = await pool.query(
    `SELECT ${EXPENSE_COLUMNS}, count(*) OVER () AS total_count
       FROM expenses
      WHERE ${conditions.join(" AND ")}
      ORDER BY spent_on DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    values
  )

  const total =
    result.rows.length > 0 ? Number(result.rows[0].total_count) : 0
  return { items: result.rows.map(mapExpenseRow), total }
}

export interface ExpensePatch {
  description?: unknown
  category?: unknown
  amount?: unknown
  currency?: unknown
  spentOn?: unknown
  notes?: unknown
}

export async function updateExpense(
  userId: string,
  id: string,
  patch: ExpensePatch
): Promise<ExpenseRow> {
  const current = await getExpense(userId, id)

  const provided = Object.values(patch).some((value) => value !== undefined)
  if (!provided) {
    throw new AppError(
      422,
      "no_changes",
      "No se enviaron campos para actualizar."
    )
  }

  // The closed-list/amount/date rules run on the merged result: a patch may
  // carry a single field and the rest keeps its stored value.
  const next = validateExpenseInput({
    description: patch.description !== undefined ? patch.description : current.description,
    category: patch.category !== undefined ? patch.category : current.category,
    amount: patch.amount !== undefined ? patch.amount : current.amount,
    currency: patch.currency !== undefined ? patch.currency : current.currency,
    spentOn: patch.spentOn !== undefined ? patch.spentOn : current.spentOn,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
  })

  const frozen =
    next.amount === current.amount &&
    next.currency === current.currency &&
    next.spentOn === current.spentOn
  const { exchangeRate, mxnEquivalent } = frozen
    ? {
        exchangeRate: current.exchangeRate,
        mxnEquivalent: current.mxnEquivalent,
      }
    : await resolveMxnConversion(next.amount, next.currency, next.spentOn)

  const result = await pool.query(
    `UPDATE expenses
        SET description = $3, category = $4, amount = $5, currency = $6,
            exchange_rate = $7, mxn_equivalent = $8, spent_on = $9,
            notes = $10, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING ${EXPENSE_COLUMNS}`,
    [
      id,
      userId,
      next.description,
      next.category,
      next.amount.toFixed(2),
      next.currency,
      exchangeRate !== null ? exchangeRate.toFixed(6) : null,
      mxnEquivalent !== null ? mxnEquivalent.toFixed(2) : null,
      next.spentOn,
      next.notes,
    ]
  )
  return mapExpenseRow(result.rows[0])
}

export async function softDeleteExpense(
  userId: string,
  id: string
): Promise<void> {
  const result = await pool.query(
    `UPDATE expenses
        SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  )
  if (result.rowCount === 0) {
    throw new AppError(404, "not_found", "El gasto no existe.")
  }
}

function mapBucket(row: Record<string, unknown>): ExpenseSummaryBucket {
  return {
    key: row.key as string,
    count: Number(row.count),
    totalMxn: toNumber(row.total_mxn) ?? 0,
    usdPending: toNumber(row.usd_pending) ?? 0,
  }
}

const SUMMARY_AGGREGATES = `count(*) AS count,
  sum(mxn_equivalent) AS total_mxn,
  sum(CASE WHEN mxn_equivalent IS NULL AND currency = 'USD' THEN amount END) AS usd_pending`

export async function summarizeExpenses(
  userId: string,
  params: { from?: string; to?: string } = {}
): Promise<ExpenseSummary> {
  const today = mxDayKey(new Date())
  const from = assertFilterDay(params.from, "La fecha inicial") ?? `${today.slice(0, 4)}-01-01`
  const to = assertFilterDay(params.to, "La fecha final") ?? today
  if (from > to) {
    throw new AppError(
      422,
      "validation_error",
      "La fecha inicial no puede ser posterior a la fecha final."
    )
  }

  const base = await pool.query(
    `SELECT ${SUMMARY_AGGREGATES},
       count(*) FILTER (WHERE mxn_equivalent IS NULL AND currency = 'USD') AS usd_pending_count
      FROM expenses
     WHERE user_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2 AND $3`,
    [userId, from, to]
  )
  const totals = base.rows[0] ?? {}

  const byCategoryResult = await pool.query(
    `SELECT category AS key, ${SUMMARY_AGGREGATES}
       FROM expenses
      WHERE user_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2 AND $3
      GROUP BY category
      ORDER BY total_mxn DESC NULLS LAST, category`,
    [userId, from, to]
  )

  const byMonthResult = await pool.query(
    `SELECT to_char(spent_on, 'YYYY-MM') AS key, ${SUMMARY_AGGREGATES}
       FROM expenses
      WHERE user_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2 AND $3
      GROUP BY 1
      ORDER BY 1`,
    [userId, from, to]
  )

  return {
    from,
    to,
    count: Number(totals.count ?? 0),
    totalMxn: toNumber(totals.total_mxn) ?? 0,
    usdPending: toNumber(totals.usd_pending) ?? 0,
    usdPendingCount: Number(totals.usd_pending_count ?? 0),
    byCategory: byCategoryResult.rows.map(mapBucket),
    byMonth: byMonthResult.rows.map(mapBucket),
  }
}
