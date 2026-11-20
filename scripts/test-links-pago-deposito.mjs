/**
 * Pruebas de la lógica pura del casado orden ↔ depósito de SPEILink
 * (src/lib/links-pago.ts): clasificación de pagos tipo depósito
 * (`isDepositLikePayment`, ambos rieles SPEI CLABE y billetera MP),
 * ventana de casado (`depositWithinOrderWindow`, slack de 2 minutos) e
 * igualdad de importes a centavos (`amountsEqualCents`). Corre con Node
 * directo (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-links-pago-deposito.mjs
 */
import assert from "node:assert/strict"

import {
  amountsEqualCents,
  depositWithinOrderWindow,
  isDepositLikePayment,
  normalizePaymentOrderConcepto,
  paymentOrderConceptAnchor,
  PAYMENT_ORDER_CONCEPTO_ERROR,
  PAYMENT_ORDER_DEPOSIT_SLACK_MS,
} from "../src/lib/links-pago.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/* ------------------------ isDepositLikePayment --------------------------- */

check("SPEI a la CLABE aprobado y acreditado es depósito", () => {
  assert.equal(
    isDepositLikePayment({
      operationType: "account_fund",
      status: "approved",
      statusDetail: "accredited",
    }),
    true
  )
})

check("transferencia desde saldo de otra cuenta MP es depósito", () => {
  assert.equal(
    isDepositLikePayment({
      operationType: "money_transfer",
      status: "approved",
      statusDetail: "accredited",
    }),
    true
  )
})

check("un pago de checkout (regular_payment) NO es depósito", () => {
  assert.equal(
    isDepositLikePayment({
      operationType: "regular_payment",
      status: "approved",
      statusDetail: "accredited",
    }),
    false
  )
})

check("un pago pendiente NO es depósito aunque el riel calce", () => {
  assert.equal(
    isDepositLikePayment({
      operationType: "account_fund",
      status: "pending",
      statusDetail: "pending_waiting_transfer",
    }),
    false
  )
})

check("acreditación distinta de accredited NO es depósito", () => {
  assert.equal(
    isDepositLikePayment({
      operationType: "money_transfer",
      status: "approved",
      statusDetail: "accredited_other",
    }),
    false
  )
})

check("operation_type ausente o no string NO es depósito", () => {
  assert.equal(
    isDepositLikePayment({ status: "approved", statusDetail: "accredited" }),
    false
  )
  assert.equal(
    isDepositLikePayment({
      operationType: 123,
      status: "approved",
      statusDetail: "accredited",
    }),
    false
  )
})

/* ----------------------- depositWithinOrderWindow ------------------------ */

const MIN = 60_000
const CREADA = 1_700_000_000_000

check("el depósito dentro de la ventana calza", () => {
  assert.equal(
    depositWithinOrderWindow({
      orderCreatedAtMs: CREADA,
      depositAtMs: CREADA + 5 * MIN,
    }),
    true
  )
})

check("el depósito dentro del slack ANTERIOR a la creación calza", () => {
  assert.equal(
    depositWithinOrderWindow({
      orderCreatedAtMs: CREADA,
      depositAtMs: CREADA - PAYMENT_ORDER_DEPOSIT_SLACK_MS,
    }),
    true
  )
})

check("el depósito ANTES del slack (pago de otra orden vieja) no calza", () => {
  assert.equal(
    depositWithinOrderWindow({
      orderCreatedAtMs: CREADA,
      depositAtMs: CREADA - PAYMENT_ORDER_DEPOSIT_SLACK_MS - 1,
    }),
    false
  )
})

check("el límite exacto del slack calza (ventana inclusiva)", () => {
  assert.equal(
    depositWithinOrderWindow({
      orderCreatedAtMs: CREADA,
      depositAtMs: CREADA - PAYMENT_ORDER_DEPOSIT_SLACK_MS,
    }),
    true
  )
})

check("depósito sin fecha legible no calza (jamás un claim a ciegas)", () => {
  assert.equal(
    depositWithinOrderWindow({ orderCreatedAtMs: CREADA, depositAtMs: null }),
    false
  )
  assert.equal(
    depositWithinOrderWindow({
      orderCreatedAtMs: CREADA,
      depositAtMs: Number.NaN,
    }),
    false
  )
})

check("orden con fecha de creación ilegible no calza", () => {
  assert.equal(
    depositWithinOrderWindow({
      orderCreatedAtMs: Number.NaN,
      depositAtMs: CREADA,
    }),
    false
  )
})

/* ---------------------------- amountsEqualCents --------------------------- */

check("importes idénticos son iguales a centavos", () => {
  assert.equal(amountsEqualCents(500, 500), true)
  assert.equal(amountsEqualCents(100.5, 100.5), true)
})

check("la diferencia por debajo del centavo es igualdad (flotantes)", () => {
  assert.equal(amountsEqualCents(0.1 + 0.2, 0.3), true)
})

check("un centavo de diferencia NO es igualdad", () => {
  assert.equal(amountsEqualCents(500, 500.01), false)
  assert.equal(amountsEqualCents(99.99, 100), false)
})

check("importes de distinto signo no son iguales", () => {
  assert.equal(amountsEqualCents(-5, 5), false)
})

/* --------------------- concepto de pago (ancla nueva) --------------------- */

check("una palabra alfanumérica válida se normaliza a mayúsculas", () => {
  assert.equal(normalizePaymentOrderConcepto("VentaJuana"), "VENTAJUANA")
  assert.equal(normalizePaymentOrderConcepto("  pago350  "), "PAGO350")
})

check("los acentos se quitan (los bancos también al imprimir)", () => {
  assert.equal(normalizePaymentOrderConcepto("Instalación"), "INSTALACION")
  assert.equal(normalizePaymentOrderConcepto("ESPAÑA"), "ESPANA")
})

check("espacios y caracteres especiales NO se aceptan (una sola palabra)", () => {
  assert.equal(normalizePaymentOrderConcepto("Venta Juana"), null)
  assert.equal(normalizePaymentOrderConcepto("pago-juan"), null)
  assert.equal(normalizePaymentOrderConcepto("pago_juan"), null)
  assert.equal(normalizePaymentOrderConcepto("pago!"), null)
  assert.equal(normalizePaymentOrderConcepto(""), null)
})

check("longitud del concepto: mínimo 3, máximo 20", () => {
  assert.equal(normalizePaymentOrderConcepto("AB"), null)
  assert.equal(normalizePaymentOrderConcepto("ABC"), "ABC")
  assert.equal(normalizePaymentOrderConcepto("A".repeat(20)), "A".repeat(20))
  assert.equal(normalizePaymentOrderConcepto("A".repeat(21)), null)
})

check("el mensaje de error del concepto menciona la regla", () => {
  assert.match(PAYMENT_ORDER_CONCEPTO_ERROR, /una sola palabra alfanumérica/i)
  assert.match(PAYMENT_ORDER_CONCEPTO_ERROR, /3 a 20/)
})

check("el ancla de conciliación es la palabra cuando existe", () => {
  assert.equal(
    paymentOrderConceptAnchor({ note: "VENTAJUANA", code: "P36E" }),
    "VENTAJUANA"
  )
})

check("el ancla de una orden previa (sin palabra) sigue siendo el código", () => {
  assert.equal(
    paymentOrderConceptAnchor({ note: null, code: "P36E" }),
    "P36E"
  )
  assert.equal(
    paymentOrderConceptAnchor({
      note: "Instalación de Juan",
      code: "P36E",
    }),
    "P36E"
  )
})

console.log(`\n${passed} pruebas OK`)
