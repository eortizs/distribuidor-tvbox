/**
 * Pruebas de la lógica pura del canal del PAGADOR de un link de pago
 * (src/lib/links-pago.ts): cada link se solicita y se paga por separado.
 * Cubre el texto prellenado con el código del link (`paymentOrderRequestText`)
 * y su lectura (`parsePaymentOrderRequestAmount`, `findPaymentOrderCodeTokens`,
 * `isPaymentLinkCode`), y la elección de la orden cuando varias comparten
 * la palabra del concepto de pago
 * (`desambiguarComprobantePorConcepto`: código del caption, importe leído y
 * teléfono del pagador ligado). Corre con Node directo (Node 24 elimina
 * tipos al importar .ts):
 *
 *   node scripts/test-links-pago-pagador.mjs
 */
import assert from "node:assert/strict"

import {
  desambiguarComprobantePorConcepto,
  findPaymentOrderCodeTokens,
  isPaymentLinkCode,
  MAX_PAYMENT_ORDER_CODE_TOKENS,
  parsePaymentOrderRequestAmount,
  paymentOrderRequestText,
} from "../src/lib/links-pago.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/** Orden activa mínima con la forma que usa el canal del pagador. */
function orden(code, note, amountMxn, payerPhone = null, status = "pending") {
  return { id: `id-${code}`, code, note, amountMxn, status, payerPhone }
}

/* ----------------------- texto de la solicitud --------------------------- */

check("la solicitud lleva el importe y el CÓDIGO del link", () => {
  assert.equal(
    paymentOrderRequestText(100, "LZQF"),
    "Solicito un link de pago por $100.00 MXN (código LZQF)"
  )
  assert.equal(
    paymentOrderRequestText(1500.5, "AA73"),
    "Solicito un link de pago por $1500.50 MXN (código AA73)"
  )
})

check("el monto de la solicitud se sigue leyendo del texto nuevo", () => {
  assert.equal(parsePaymentOrderRequestAmount(paymentOrderRequestText(100, "LZQF")), 100)
  assert.equal(parsePaymentOrderRequestAmount(paymentOrderRequestText(1500.5, "AA73")), 1500.5)
  assert.equal(parsePaymentOrderRequestAmount(paymentOrderRequestText(11.13, "MXN2")), 11.13)
})

check("las formas antiguas sin código siguen leyéndose", () => {
  assert.equal(parsePaymentOrderRequestAmount("Solicito un link de pago por $500.00 MXN"), 500)
  assert.equal(parsePaymentOrderRequestAmount("Solicito una orden de pago por 1,500.50"), 1500.5)
  assert.equal(parsePaymentOrderRequestAmount("Solicito una liga de pago por 500,50 MXN"), 500.5)
  assert.equal(parsePaymentOrderRequestAmount("Solicito un link de pago por 500"), 500)
})

check("un texto que no es solicitud o con monto inválido no da monto", () => {
  assert.equal(parsePaymentOrderRequestAmount("Hola, buenos días"), null)
  assert.equal(parsePaymentOrderRequestAmount("Solicito un link de pago por $0"), null)
  assert.equal(parsePaymentOrderRequestAmount(""), null)
})

/* ----------------------------- código del link --------------------------- */

check("forma del código: 4 caracteres del alfabeto sin 0/O/1/I", () => {
  for (const code of ["LZQF", "AA73", "G5KE", "GBAR", "CRBM", "2345"]) {
    assert.equal(isPaymentLinkCode(code), true, code)
  }
  for (const code of ["LZQI", "LZQO", "LZQ0", "LZQ1", "LZQ", "LZQFA", "", "LZ F"]) {
    assert.equal(isPaymentLinkCode(code), false, code)
  }
})

check("el único token con forma de código de la solicitud es SU código", () => {
  const casos = [
    [100, "LZQF"],
    [2345, "CHAT"],
    [10, "TEST"],
    [50000, "MXN2"],
    [11.13, "PAG2"],
    [1500.5, "AA73"],
  ]
  for (const [amountMxn, code] of casos) {
    const tokens = findPaymentOrderCodeTokens(paymentOrderRequestText(amountMxn, code))
    assert.deepEqual(tokens, [code], `${amountMxn} ${code}`)
  }
})

check("tokens: mayúsculas, pegados en texto y sin duplicados", () => {
  assert.deepEqual(findPaymentOrderCodeTokens("lzqf"), ["LZQF"])
  assert.deepEqual(findPaymentOrderCodeTokens("Pago de LZQF, gracias. lzqf GBAR"), [
    "LZQF",
    "GBAR",
  ])
})

check("tokens: palabras con letras ambiguas o de otra longitud no cuentan", () => {
  assert.deepEqual(findPaymentOrderCodeTokens("HOLA LINK PAGO CODIGO MXN"), [])
  assert.deepEqual(findPaymentOrderCodeTokens("1000 2345 00 100"), ["2345"])
  assert.deepEqual(findPaymentOrderCodeTokens(""), [])
})

check("tokens: tope por mensaje", () => {
  const codes = ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE", "FFFF", "GGGG"]
  assert.equal(MAX_PAYMENT_ORDER_CODE_TOKENS, 5)
  assert.deepEqual(findPaymentOrderCodeTokens(codes.join(" ")), codes.slice(0, 5))
})

/* ------------------ comprobante entre varias de la misma palabra ---------- */

const PHONE = "525500000001"
const OTRO = "525500000002"

function elegir(coincidentes, extra = {}) {
  return desambiguarComprobantePorConcepto({
    coincidentes,
    importeTexto: null,
    tokens: [],
    phone: PHONE,
    ...extra,
  })
}

check("sin coincidentes no hay orden ni ambigüedad", () => {
  assert.deepEqual(elegir([]), { order: null, ambiguo: false, via: null })
})

check("una sola coincidente es la orden", () => {
  const a = orden("GBAR", "ELDA", 100)
  assert.deepEqual(elegir([a]), { order: a, ambiguo: false, via: "unica" })
})

check("misma palabra, distinto importe: el importe leído elige", () => {
  const a = orden("GBAR", "ELDA", 1100)
  const b = orden("CRBM", "ELDA", 200)
  assert.deepEqual(elegir([a, b], { importeTexto: "$200.00" }), {
    order: b,
    ambiguo: false,
    via: "importe",
  })
  assert.deepEqual(elegir([a, b], { importeTexto: "1,100.00" }), {
    order: a,
    ambiguo: false,
    via: "importe",
  })
})

check("misma palabra e importe, sin más señales: ambiguo (jamás se arriesga)", () => {
  const a = orden("GBAR", "ELDA", 100)
  const b = orden("CRBM", "ELDA", 100)
  const r = elegir([a, b], { importeTexto: "100" })
  assert.equal(r.ambiguo, true)
  assert.equal(r.order, null)
})

check("misma palabra e importe: el código del caption elige", () => {
  const a = orden("GBAR", "ELDA", 100)
  const b = orden("CRBM", "ELDA", 100)
  assert.deepEqual(elegir([a, b], { importeTexto: "100", tokens: ["CRBM"] }), {
    order: b,
    ambiguo: false,
    via: "codigo",
  })
  assert.deepEqual(elegir([a, b], { importeTexto: "100", tokens: ["GBAR", "ZZZZ"] }), {
    order: a,
    ambiguo: false,
    via: "codigo",
  })
})

check("el código explícito del caption manda sobre el importe", () => {
  const a = orden("GBAR", "ELDA", 100)
  const b = orden("CRBM", "ELDA", 200)
  assert.deepEqual(elegir([a, b], { importeTexto: "100", tokens: ["CRBM"] }), {
    order: b,
    ambiguo: false,
    via: "codigo",
  })
})

check("misma palabra e importe: el teléfono ligado a UNA sola elige", () => {
  const a = orden("GBAR", "ELDA", 100, PHONE)
  const b = orden("CRBM", "ELDA", 100)
  assert.deepEqual(elegir([a, b], { importeTexto: "100" }), {
    order: a,
    ambiguo: false,
    via: "telefono",
  })
  assert.deepEqual(elegir([a, { ...b, payerPhone: PHONE }], { importeTexto: "100", phone: "525500000003" }), {
    order: null,
    ambiguo: true,
    via: null,
  })
  const ligada = orden("CRBM", "ELDA", 100, PHONE)
  const tercera = elegir([orden("GBAR", "ELDA", 100), ligada], { importeTexto: "100" })
  assert.equal(tercera.order, ligada)
  assert.equal(tercera.via, "telefono")
})

check("el teléfono de OTRO pagador no elige", () => {
  const a = orden("GBAR", "ELDA", 100, OTRO)
  const b = orden("CRBM", "ELDA", 100)
  assert.equal(elegir([a, b], { importeTexto: "100" }).ambiguo, true)
  assert.deepEqual(elegir([a, b], { importeTexto: "100", phone: OTRO }), {
    order: a,
    ambiguo: false,
    via: "telefono",
  })
})

check("un teléfono ligado a varias coincidentes sigue siendo ambiguo", () => {
  const a = orden("GBAR", "ELDA", 100, PHONE)
  const b = orden("CRBM", "ELDA", 100, PHONE)
  assert.equal(elegir([a, b], { importeTexto: "100" }).ambiguo, true)
})

check("importe ilegible: el teléfono o el código del caption deciden", () => {
  const a = orden("GBAR", "ELDA", 100, PHONE)
  const b = orden("CRBM", "ELDA", 100)
  assert.deepEqual(elegir([a, b], { importeTexto: null }), {
    order: a,
    ambiguo: false,
    via: "telefono",
  })
  assert.deepEqual(elegir([a, b], { importeTexto: null, tokens: ["CRBM"] }), {
    order: b,
    ambiguo: false,
    via: "codigo",
  })
  assert.equal(elegir([b, orden("LZQF", "ELDA", 250)], { importeTexto: null }).ambiguo, true)
})

check("importe que no calza con ninguna: ambiguo salvo código del caption", () => {
  const a = orden("GBAR", "ELDA", 100, PHONE)
  const b = orden("CRBM", "ELDA", 100, PHONE)
  assert.equal(elegir([a, b], { importeTexto: "150" }).ambiguo, true)
  assert.deepEqual(elegir([a, b], { importeTexto: "150", tokens: ["CRBM"] }), {
    order: b,
    ambiguo: false,
    via: "codigo",
  })
})

check("una hermana en verificación ligada al teléfono responde su estado", () => {
  const a = orden("GBAR", "ELDA", 100, PHONE, "verifying")
  const b = orden("CRBM", "ELDA", 100)
  assert.deepEqual(elegir([a, b], { importeTexto: "100" }), {
    order: a,
    ambiguo: false,
    via: "telefono",
  })
})

check("tres coincidentes: solo una ligada al teléfono elige a esa", () => {
  const a = orden("GBAR", "ELDA", 100, PHONE)
  const b = orden("CRBM", "ELDA", 100)
  const c = orden("LZQF", "ELDA", 100, OTRO)
  assert.deepEqual(elegir([a, b, c], { importeTexto: "100" }), {
    order: a,
    ambiguo: false,
    via: "telefono",
  })
  assert.deepEqual(elegir([a, c, b], { importeTexto: "100", phone: OTRO }), {
    order: c,
    ambiguo: false,
    via: "telefono",
  })
  assert.equal(
    elegir([a, b, c], { importeTexto: "100", phone: "525500000003" }).ambiguo,
    true
  )
})

check("el importe de la solicitud no cuenta como código (ni en el caption)", () => {
  assert.deepEqual(findPaymentOrderCodeTokens("Solicito un link de pago por $2345.00 MXN (código CHAT)"), [
    "CHAT",
  ])
  assert.deepEqual(findPaymentOrderCodeTokens("Solicito un link de pago por 2345 GBAR"), [
    "GBAR",
  ])
  // Fuera de una solicitud los dígitos siguen siendo tokens (códigos numéricos).
  assert.deepEqual(findPaymentOrderCodeTokens("2345 GBAR"), ["2345", "GBAR"])
})

console.log(`\n${passed} pruebas OK`)
