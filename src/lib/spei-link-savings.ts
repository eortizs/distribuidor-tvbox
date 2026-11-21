export const TRADITIONAL_TERMINAL_FEE_RATE = 0.04
export const SAVINGS_MIN_SALES_MXN = 5_000
export const SAVINGS_MAX_SALES_MXN = 200_000
export const SAVINGS_STEP_MXN = 1_000
export const SAVINGS_DEFAULT_SALES_MXN = 50_000
export const SAVINGS_PRESETS_MXN = [15_000, 30_000, 50_000, 100_000] as const

export interface SpeiLinkSavings {
  monthlySalesMxn: number
  traditionalMonthlyFeeMxn: number
  traditionalAnnualFeeMxn: number
  speiLinkMonthlyFeeMxn: 0
  speiLinkAnnualFeeMxn: 0
  monthlySavingsMxn: number
  annualSavingsMxn: number
}

export function clampMonthlySalesMxn(value: number): number {
  if (!Number.isFinite(value)) {
    return SAVINGS_DEFAULT_SALES_MXN
  }
  return Math.min(
    SAVINGS_MAX_SALES_MXN,
    Math.max(SAVINGS_MIN_SALES_MXN, Math.round(value))
  )
}

export function calculateSpeiLinkSavings(monthlySalesMxn: number): SpeiLinkSavings {
  const safeSales = clampMonthlySalesMxn(monthlySalesMxn)
  const traditionalMonthlyFeeMxn = Math.round(
    safeSales * TRADITIONAL_TERMINAL_FEE_RATE
  )
  const traditionalAnnualFeeMxn = traditionalMonthlyFeeMxn * 12
  return {
    monthlySalesMxn: safeSales,
    traditionalMonthlyFeeMxn,
    traditionalAnnualFeeMxn,
    speiLinkMonthlyFeeMxn: 0,
    speiLinkAnnualFeeMxn: 0,
    monthlySavingsMxn: traditionalMonthlyFeeMxn,
    annualSavingsMxn: traditionalAnnualFeeMxn,
  }
}

const mxnWholeFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
})

export function formatMxnWhole(amount: number): string {
  const whole = Math.round(Number.isFinite(amount) ? amount : 0)
  const sign = whole < 0 ? "-" : ""
  return `${sign}$${mxnWholeFormatter.format(Math.abs(whole))}`
}
