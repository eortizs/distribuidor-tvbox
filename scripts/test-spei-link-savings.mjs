import assert from "node:assert/strict"

import {
  SAVINGS_DEFAULT_SALES_MXN,
  SAVINGS_MAX_SALES_MXN,
  SAVINGS_MIN_SALES_MXN,
  SAVINGS_PRESETS_MXN,
  calculateSpeiLinkSavings,
  clampMonthlySalesMxn,
  formatMxnWhole,
} from "../src/lib/spei-link-savings.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

check("valor por defecto: $50,000 → 4%/mes, 12x al año, SPEILink 0%", () => {
  const savings = calculateSpeiLinkSavings(SAVINGS_DEFAULT_SALES_MXN)
  assert.equal(savings.monthlySalesMxn, 50_000)
  assert.equal(savings.traditionalMonthlyFeeMxn, 2_000)
  assert.equal(savings.traditionalAnnualFeeMxn, 24_000)
  assert.equal(savings.annualSavingsMxn, 24_000)
  assert.equal(savings.speiLinkMonthlyFeeMxn, 0)
  assert.equal(savings.speiLinkAnnualFeeMxn, 0)
  assert.equal(savings.monthlySavingsMxn, 2_000)
})

check("preset $15,000 → $600/mes, $7,200/año", () => {
  const savings = calculateSpeiLinkSavings(15_000)
  assert.equal(savings.traditionalMonthlyFeeMxn, 600)
  assert.equal(savings.traditionalAnnualFeeMxn, 7_200)
})

check("preset $30,000 → $1,200/mes, $14,400/año", () => {
  const savings = calculateSpeiLinkSavings(30_000)
  assert.equal(savings.traditionalMonthlyFeeMxn, 1_200)
  assert.equal(savings.traditionalAnnualFeeMxn, 14_400)
})

check("preset $100,000 → $4,000/mes, $48,000/año", () => {
  const savings = calculateSpeiLinkSavings(100_000)
  assert.equal(savings.traditionalMonthlyFeeMxn, 4_000)
  assert.equal(savings.traditionalAnnualFeeMxn, 48_000)
})

check("límite mínimo $5,000 → $200/mes, $2,400/año", () => {
  const savings = calculateSpeiLinkSavings(SAVINGS_MIN_SALES_MXN)
  assert.equal(savings.monthlySalesMxn, 5_000)
  assert.equal(savings.traditionalMonthlyFeeMxn, 200)
  assert.equal(savings.traditionalAnnualFeeMxn, 2_400)
})

check("límite máximo $200,000 → $8,000/mes, $96,000/año", () => {
  const savings = calculateSpeiLinkSavings(SAVINGS_MAX_SALES_MXN)
  assert.equal(savings.monthlySalesMxn, 200_000)
  assert.equal(savings.traditionalMonthlyFeeMxn, 8_000)
  assert.equal(savings.traditionalAnnualFeeMxn, 96_000)
})

check("clamping por debajo del mínimo (100 y -5,000)", () => {
  assert.equal(clampMonthlySalesMxn(100), 5_000)
  assert.equal(clampMonthlySalesMxn(-5_000), 5_000)
  assert.equal(calculateSpeiLinkSavings(100).monthlySalesMxn, 5_000)
})

check("clamping por encima del máximo (500,000)", () => {
  assert.equal(clampMonthlySalesMxn(500_000), 200_000)
  assert.equal(calculateSpeiLinkSavings(500_000).monthlySalesMxn, 200_000)
})

check("entradas no finitas caen al valor por defecto", () => {
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(clampMonthlySalesMxn(value), SAVINGS_DEFAULT_SALES_MXN)
    assert.equal(calculateSpeiLinkSavings(value).monthlySalesMxn, 50_000)
  }
})

check("formatMxnWhole y los cuatro presets exactos", () => {
  assert.equal(formatMxnWhole(0), "$0")
  assert.equal(formatMxnWhole(2_000), "$2,000")
  assert.equal(formatMxnWhole(24_000), "$24,000")
  assert.equal(formatMxnWhole(Number.NaN), "$0")
  assert.deepEqual(SAVINGS_PRESETS_MXN, [15_000, 30_000, 50_000, 100_000])
})

console.log(`\n${passed} pruebas OK`)
