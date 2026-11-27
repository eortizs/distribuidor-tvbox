/**
 * Pruebas de la lógica pura del QR FIJO de cobro —pago libre—
 * (src/lib/links-pago.ts): código de cobrador, mensaje inicial («Solicito
 * realizar un pago. (cobrador XXXXXX)»), ruta del dominio corto, a quién se
 * atribuye el comprobante de un teléfono (`cobradorDelQr`), desde cuándo
 * corre la ventana de depósito de la orden (`paymentQrOrderStart`), el
 * importe leído del comprobante y el concepto libre. Corre con Node directo
 * (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-links-pago-qr-fijo.mjs
 */
import assert from "node:assert/strict"

import {
  amountsEqualCents,
  cobradorDelQr,
  cobradorQrRequestText,
  cobradorQrShortPath,
  conceptoLibreDeComprobante,
  findPaymentOrderCodeTokens,
  instanteDelComprobante,
  isCobradorQrCode,
  isCobradorQrPath,
  leerImporteDeComprobante,
  parseCobradorQrPath,
  parseCobradorQrRequest,
  parsePaymentOrderRequestAmount,
  PAYMENT_ORDER_NOTE_MAX,
  PAYMENT_QR_REPORT_LABEL,
  PAYMENT_QR_REQUEST_FRESH_MS,
  PAYMENT_QR_REQUEST_WINDOW_MS,
  paymentQrOrderStart,
  QR_MAX_ACTIVE_PER_PAYER,
} from "../src/lib/links-pago.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

const CODE = "K7QM2P"
const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/** «2026-11-27 09:41» en hora de México (UTC−6) = 15:41 UTC. */
const AHORA = Date.parse("2026-11-27T16:00:00Z")
const iso = (ms) => new Date(ms).toISOString()

const solicitud = (cobradorUserId, lastRequestedAt) => ({
  cobradorUserId,
  lastRequestedAt,
})

/* --------------------------- código de cobrador --------------------------- */

check("forma del código: 6 caracteres del alfabeto sin 0/O/1/I", () => {
  for (const code of ["K7QM2P", "AAAAAA", "234567", "ZZZZZZ"]) {
    assert.equal(isCobradorQrCode(code), true, code)
  }
  for (const code of ["K7QM2", "K7QM2PX", "K7QM2O", "K7QM20", "K7QM2I", "K7QM21", "k7qm2p", ""]) {
    assert.equal(isCobradorQrCode(code), false, code)
  }
})

check("el código de cobrador jamás es un token de código de link", () => {
  // Un link tiene 4 caracteres: el de cobrador (6) nunca puede señalar una orden.
  assert.deepEqual(findPaymentOrderCodeTokens(cobradorQrRequestText(CODE)), [])
  assert.deepEqual(findPaymentOrderCodeTokens(`cobrador ${CODE} GBAR`), ["GBAR"])
})

/* --------------------------- mensaje inicial ----------------------------- */

check("el mensaje inicial es la frase del dueño con el código del cobrador", () => {
  assert.equal(
    cobradorQrRequestText(CODE),
    "Solicito realizar un pago. (cobrador K7QM2P)"
  )
})

check("la solicitud se lee con el código en mayúsculas", () => {
  assert.deepEqual(parseCobradorQrRequest(cobradorQrRequestText(CODE)), { code: CODE })
  assert.deepEqual(
    parseCobradorQrRequest("solicito realizar un pago (cobrador k7qm2p)"),
    { code: CODE }
  )
})

check("la frase sin código válido da code null (guía, nunca una orden)", () => {
  assert.deepEqual(parseCobradorQrRequest("Solicito realizar un pago."), { code: null })
  assert.deepEqual(parseCobradorQrRequest("Solicito realizar un pago. (cobrador K7QM)"), {
    code: null,
  })
  assert.deepEqual(parseCobradorQrRequest("Solicito realizar un pago. (cobrador K7QM2PX)"), {
    code: null,
  })
})

check("un mensaje que no es la solicitud del QR no se toma como tal", () => {
  assert.equal(parseCobradorQrRequest("Solicito un link de pago por $100 (código GBAR)"), null)
  assert.equal(parseCobradorQrRequest("Quiero realizar un pago"), null)
  assert.equal(parseCobradorQrRequest("350"), null)
  assert.equal(parseCobradorQrRequest(""), null)
  // La frase del QR NO es una solicitud de link (no trae importe).
  assert.equal(parsePaymentOrderRequestAmount(cobradorQrRequestText(CODE)), null)
})

/* ---------------------------- ruta del dominio --------------------------- */

check("ruta corta: spei.link/cobro/<CÓDIGO>", () => {
  assert.equal(cobradorQrShortPath(CODE), `/cobro/${CODE}`)
  assert.equal(parseCobradorQrPath("/cobro/K7QM2P"), CODE)
  assert.equal(parseCobradorQrPath("/cobro/k7qm2p"), CODE)
  assert.equal(parseCobradorQrPath("/COBRO/K7QM2P/"), CODE)
})

check("ruta corta inválida: null, pero sigue siendo el espacio del QR", () => {
  for (const path of [
    "/cobro/K7QM",
    "/cobro/K7QM2PX",
    "/cobro/K7QM20",
    "/cobro/K7QM2P/extra",
    "/cobro/%41%42",
    "/cobro",
  ]) {
    assert.equal(parseCobradorQrPath(path), null, path)
    assert.equal(isCobradorQrPath(path), true, path)
  }
})

check("fuera del espacio del QR la ruta no es del QR", () => {
  assert.equal(parseCobradorQrPath("/GBAR"), null)
  assert.equal(isCobradorQrPath("/GBAR"), false)
  assert.equal(isCobradorQrPath("/cobros/K7QM2P"), false)
  assert.equal(isCobradorQrPath("/afiliado/K7QM2P"), false)
  assert.equal(isCobradorQrPath("/"), false)
})

/* ------------------- a quién se atribuye el comprobante ------------------ */

check("constantes del pago libre", () => {
  assert.equal(PAYMENT_QR_REQUEST_WINDOW_MS, 7 * DIA)
  assert.equal(PAYMENT_QR_REQUEST_FRESH_MS, 30 * MINUTO)
  assert.equal(QR_MAX_ACTIVE_PER_PAYER, 3)
  assert.equal(PAYMENT_QR_REPORT_LABEL, "QR fijo")
})

check("sin solicitudes vigentes no hay a quién atribuir el cobro", () => {
  assert.deepEqual(cobradorDelQr([], AHORA), { kind: "sin_solicitud" })
})

check("una sola solicitud vigente: ese cobrador, con su último escaneo", () => {
  assert.deepEqual(
    cobradorDelQr([solicitud("cob-1", iso(AHORA - 3 * DIA))], AHORA),
    {
      kind: "cobrador",
      cobradorUserId: "cob-1",
      lastRequestedAt: iso(AHORA - 3 * DIA),
    }
  )
})

check("varias solicitudes: gana el último escaneo si es reciente", () => {
  const solicitudes = [
    solicitud("cob-1", iso(AHORA - 2 * HORA)),
    solicitud("cob-2", iso(AHORA - 5 * MINUTO)),
  ]
  assert.deepEqual(cobradorDelQr(solicitudes, AHORA), {
    kind: "cobrador",
    cobradorUserId: "cob-2",
    lastRequestedAt: iso(AHORA - 5 * MINUTO),
  })
  // El orden de la lista no importa: manda la fecha.
  assert.equal(cobradorDelQr([...solicitudes].reverse(), AHORA).cobradorUserId, "cob-2")
})

check("varias solicitudes sin un escaneo reciente que las desate: ambiguo", () => {
  // Nadie reescaneó hace menos de 30 min: no se arriesga la cuenta.
  assert.deepEqual(
    cobradorDelQr(
      [
        solicitud("cob-1", iso(AHORA - 2 * HORA)),
        solicitud("cob-2", iso(AHORA - HORA)),
      ],
      AHORA
    ),
    { kind: "ambiguo" }
  )
  // El más reciente está justo fuera de la ventana de frescura.
  assert.deepEqual(
    cobradorDelQr(
      [
        solicitud("cob-1", iso(AHORA - 2 * HORA)),
        solicitud("cob-2", iso(AHORA - PAYMENT_QR_REQUEST_FRESH_MS - 1)),
      ],
      AHORA
    ),
    { kind: "ambiguo" }
  )
  // Empate exacto entre las dos más recientes.
  assert.deepEqual(
    cobradorDelQr(
      [solicitud("cob-1", iso(AHORA - MINUTO)), solicitud("cob-2", iso(AHORA - MINUTO))],
      AHORA
    ),
    { kind: "ambiguo" }
  )
})

check("tres solicitudes: la más reciente reciente gana sobre las demás", () => {
  assert.deepEqual(
    cobradorDelQr(
      [
        solicitud("cob-1", iso(AHORA - 3 * DIA)),
        solicitud("cob-2", iso(AHORA - MINUTO)),
        solicitud("cob-3", iso(AHORA - 2 * MINUTO)),
      ],
      AHORA
    ),
    { kind: "cobrador", cobradorUserId: "cob-2", lastRequestedAt: iso(AHORA - MINUTO) }
  )
})

/* ---------------------- hora impresa en el comprobante ------------------- */

check("la fecha y la hora impresas se leen en hora de México (UTC−6)", () => {
  assert.equal(instanteDelComprobante("2026-11-27", "09:41"), Date.parse("2026-11-27T15:41:00Z"))
  assert.equal(instanteDelComprobante("2026-01-01", "00:00"), Date.parse("2026-01-01T06:00:00Z"))
})

check("la fecha y la hora impresas exigen su forma exacta", () => {
  assert.equal(instanteDelComprobante(null, "09:41"), null)
  assert.equal(instanteDelComprobante("2026-11-27", null), null)
  assert.equal(instanteDelComprobante("27/11/2026", "09:41"), null)
  assert.equal(instanteDelComprobante("2026-11-27", "9:41"), null)
  assert.equal(instanteDelComprobante("2026-11-27", "09:41:07"), null)
  assert.equal(instanteDelComprobante("2026-13-01", "09:41"), null)
})

/* --------------------- inicio de la orden y del depósito ----------------- */

const escaneo = iso(AHORA - 20 * MINUTO)

check("con hora impresa posterior al escaneo, la orden nace cuando pagó", () => {
  // Pagó a las 15:41 (09:41 de México), 19 min después de escanear.
  assert.equal(
    paymentQrOrderStart({
      lastRequestedAt: escaneo,
      receiptFecha: "2026-11-27",
      receiptHora: "09:41",
      now: AHORA,
    }).toISOString(),
    "2026-11-27T15:41:00.000Z"
  )
})

check("sin hora legible en el comprobante, la orden nace con el último escaneo", () => {
  for (const [fecha, hora] of [
    [null, "09:41"],
    ["2026-11-27", null],
    ["27/11/2026", "09:41"],
  ]) {
    assert.equal(
      paymentQrOrderStart({ lastRequestedAt: escaneo, receiptFecha: fecha, receiptHora: hora, now: AHORA }).toISOString(),
      escaneo
    )
  }
})

check("un comprobante de ANTES del escaneo no corre la ventana hacia atrás", () => {
  // La transferencia impresa es anterior al momento en que el pagador recibió
  // los datos: su depósito no puede validar este cobro.
  assert.equal(
    paymentQrOrderStart({
      lastRequestedAt: escaneo,
      receiptFecha: "2026-11-26",
      receiptHora: "20:00",
      now: AHORA,
    }).toISOString(),
    escaneo
  )
})

check("una hora impresa en el futuro no se cree: manda el escaneo", () => {
  assert.equal(
    paymentQrOrderStart({
      lastRequestedAt: escaneo,
      receiptFecha: "2026-11-27",
      receiptHora: "11:30",
      now: AHORA,
    }).toISOString(),
    escaneo
  )
})

check("un escaneo ilegible cae en «ahora» y el inicio jamás es futuro", () => {
  assert.equal(
    paymentQrOrderStart({ lastRequestedAt: "no-es-fecha", receiptFecha: null, receiptHora: null, now: AHORA }).toISOString(),
    iso(AHORA)
  )
  // Escaneo en el futuro (reloj desviado): se acota al ahora.
  assert.equal(
    paymentQrOrderStart({ lastRequestedAt: iso(AHORA + HORA), receiptFecha: null, receiptHora: null, now: AHORA }).toISOString(),
    iso(AHORA)
  )
})

/* --------------------------- importe del comprobante --------------------- */

check("el importe leído del comprobante se normaliza a centavos", () => {
  assert.equal(leerImporteDeComprobante("500.00"), 500)
  assert.equal(leerImporteDeComprobante("1,500.50"), 1500.5)
  assert.equal(leerImporteDeComprobante("1,500"), 1500)
  assert.equal(leerImporteDeComprobante("$350"), 350)
  assert.equal(leerImporteDeComprobante("350"), 350)
  assert.equal(leerImporteDeComprobante("0.50"), 0.5)
})

check("lo que no es un importe claro y positivo no se lee (no se adivina)", () => {
  for (const text of [
    "",
    "0",
    "-500",
    "abc",
    // Coma decimal o decimal con tres cifras: podría ser 500, 50 000 o 12.345.
    "500,00.00",
    "500,00",
    "12.345",
    "0.1 + 0.2",
    // El escaneo tampoco lee sufijos: si él no lo ve, aquí tampoco.
    "350 MXN",
    null,
  ]) {
    assert.equal(leerImporteDeComprobante(text), null, String(text))
  }
})

check("el importe leído compara a centavos con el de la orden", () => {
  assert.equal(amountsEqualCents(leerImporteDeComprobante("500"), 500), true)
  assert.equal(amountsEqualCents(leerImporteDeComprobante("500.01"), 500), false)
})

/* --------------------------- concepto libre ------------------------------ */

check("el concepto libre se guarda como referencia: recortado, sin renglones", () => {
  assert.equal(conceptoLibreDeComprobante("  pago de   la renta\n de noviembre "), "pago de la renta de noviembre")
  assert.equal(conceptoLibreDeComprobante("Renta"), "Renta")
  assert.equal(conceptoLibreDeComprobante("pago-juan / #1234"), "pago-juan / #1234")
})

check("sin concepto (campo ausente o vacío) no se guarda nada", () => {
  assert.equal(conceptoLibreDeComprobante(null), null)
  assert.equal(conceptoLibreDeComprobante(undefined), null)
  assert.equal(conceptoLibreDeComprobante(""), null)
  assert.equal(conceptoLibreDeComprobante("   "), null)
})

check("el concepto libre se corta al tope sin partir pares sustitutos", () => {
  const largo = "a".repeat(PAYMENT_ORDER_NOTE_MAX - 1) + "😀" + "b"
  const cortado = conceptoLibreDeComprobante(largo)
  assert.equal(Array.from(cortado).length, PAYMENT_ORDER_NOTE_MAX)
  assert.equal(cortado.endsWith("😀"), true)
})

console.log(`\n${passed} pruebas OK`)
