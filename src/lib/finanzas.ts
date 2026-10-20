export const EXPENSE_CATEGORIES = [
  "Inventario",
  "Envíos",
  "Publicidad",
  "Servicios",
  "Imágenes",
  "Animación",
  "Equipo",
  "Otros",
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export type ExpenseCurrency = "MXN" | "USD"

export interface Expense {
  id: string
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

const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "symbol",
})

const usdFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "symbol",
})

export function formatMxn(value: number): string {
  return mxnFormatter.format(value)
}

export function formatUsd(value: number): string {
  return usdFormatter.format(value)
}

export function formatAmount(value: number, currency: ExpenseCurrency): string {
  return currency === "USD" ? formatUsd(value) : formatMxn(value)
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
    new Date(Date.UTC(y, m - 1, d))
  )
}

export function formatMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return new Intl.DateTimeFormat("es-MX", {
    month: "short",
    year: "2-digit",
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** Calendar day (yyyy-mm-dd) of today in Mexico City. */
export function mxToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}
