/**
 * Pruebas de la lógica pura de NOTA DIGITAL (src/lib/nota-digital.ts y los
 * helpers compartidos de src/lib/links-pago.ts): validación del carrito,
 * redondeo a centavos, total = suma de líneas ya redondeadas, formateo del
 * desglose con tope de longitud, texto de solicitud con código de 4 y la
 * clasificación de concepto libre. Corre con Node directo (Node 24 elimina
 * tipos al importar .ts):
 *
 *   node scripts/test-nota-digital.mjs
 */
import assert from "node:assert/strict"

import {
  calcularLinea,
  cantidadTexto,
  formatearNotaDigital,
  NOTA_CANTIDAD_MAX,
  NOTA_MAX_RENGLONES,
  NOTA_TEXTO_MAX,
  redondearCentavos,
  totalDeLineas,
  validarComanda,
} from "../src/lib/nota-digital.ts"
import {
  sugiereConceptoDePago,
  findPaymentOrderCodeTokens,
  notaDigitalRequestText,
} from "../src/lib/links-pago.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

const ID_A = "11111111-1111-4111-8111-111111111111"
const ID_B = "22222222-2222-4222-8222-222222222222"

function linea(sku, nombre, precio, cantidad) {
  return {
    sku,
    nombre,
    um: "pieza",
    precioUnitario: precio,
    cantidad,
    importeLinea: calcularLinea(precio, cantidad),
  }
}

/* ------------------------------ redondeo ---------------------------------- */

check("redondearCentavos evita el error binario de 1.005", () => {
  assert.equal(redondearCentavos(1.005), 1.01)
  assert.equal(redondearCentavos(55.555), 55.56)
})

check("redondearCentavos conserva enteros y dos decimales", () => {
  assert.equal(redondearCentavos(10), 10)
  assert.equal(redondearCentavos(10.5), 10.5)
  assert.equal(redondearCentavos(0), 0)
})

check("calcularLinea es precio × cantidad a centavos", () => {
  assert.equal(calcularLinea(35, 3), 105)
  assert.equal(calcularLinea(12.34, 2.5), 30.85)
})

check("calcularLinea rechaza precios/cantidades inválidos", () => {
  assert.ok(Number.isNaN(calcularLinea(Number.NaN, 1)))
  assert.ok(Number.isNaN(calcularLinea(10, 0)))
  assert.ok(Number.isNaN(calcularLinea(-1, 1)))
})

check("el total es la suma de líneas ya redondeadas", () => {
  // 0.335 × 1 = 0.34, 0.335 × 1 = 0.34 → total 0.68 (no round(0.67)=0.67).
  const lineas = [
    linea("A", "Artículo A", 0.335, 1),
    linea("B", "Artículo B", 0.335, 1),
  ]
  assert.equal(lineas[0].importeLinea, 0.34)
  assert.equal(lineas[1].importeLinea, 0.34)
  assert.equal(totalDeLineas(lineas), 0.68)
})

/* --------------------------- validarComanda -------------------------------- */

check("carrito válido conserva id y cantidad", () => {
  const resultado = validarComanda({
    items: [
      { articuloId: ID_A, cantidad: 1 },
      { articuloId: ID_B, cantidad: 2.5 },
    ],
  })
  assert.equal(resultado.ok, true)
  if (resultado.ok) {
    assert.deepEqual(resultado.items, [
      { articuloId: ID_A, cantidad: 1 },
      { articuloId: ID_B, cantidad: 2.5 },
    ])
  }
})

check("el precio enviado por el cliente se IGNORA", () => {
  const resultado = validarComanda({
    items: [{ articuloId: ID_A, cantidad: 1, precioUnitario: 0.01 }],
  })
  assert.equal(resultado.ok, true)
  if (resultado.ok) {
    assert.deepEqual(resultado.items[0], { articuloId: ID_A, cantidad: 1 })
  }
})

check("carrito vacío y lista ausente", () => {
  assert.equal(validarComanda({ items: [] }).ok, false)
  assert.equal(validarComanda({}).ok, false)
  assert.equal(validarComanda(null).ok, false)
})

check("tope de renglones", () => {
  const items = Array.from({ length: NOTA_MAX_RENGLONES + 1 }, () => ({
    articuloId: ID_A,
    cantidad: 1,
  }))
  const resultado = validarComanda({ items })
  assert.equal(resultado.ok, false)
  if (!resultado.ok) assert.equal(resultado.code, "demasiados_renglones")
})

check("id de artículo inválido", () => {
  const resultado = validarComanda({
    items: [{ articuloId: "no-uuid", cantidad: 1 }],
  })
  assert.equal(resultado.ok, false)
  if (!resultado.ok) assert.equal(resultado.code, "articulo_id_invalido")
})

check("cantidad inválida: cero, negativa, exceso y más de 3 decimales", () => {
  for (const cantidad of [0, -1, NOTA_CANTIDAD_MAX + 1, 1.2345, "abc"]) {
    const resultado = validarComanda({
      items: [{ articuloId: ID_A, cantidad }],
    })
    assert.equal(resultado.ok, false, `cantidad ${cantidad}`)
    if (!resultado.ok) assert.equal(resultado.code, "cantidad_invalida")
  }
})

check("cantidad máxima con 3 decimales es válida", () => {
  const resultado = validarComanda({
    items: [{ articuloId: ID_A, cantidad: NOTA_CANTIDAD_MAX }],
  })
  assert.equal(resultado.ok, true)
})

check("cantidad como cadena decimal es aceptada", () => {
  const resultado = validarComanda({
    items: [{ articuloId: ID_A, cantidad: "1.250" }],
  })
  assert.equal(resultado.ok, true)
  if (resultado.ok) assert.equal(resultado.items[0].cantidad, 1.25)
})

/* --------------------------- formatearNotaDigital -------------------------- */

check("la nota incluye folio, negocio, renglones y TOTAL", () => {
  const lineas = [
    linea("CAP-1", "Capuchino grande", 55, 2),
    linea("ROL-1", "Rol de canela", 35, 1),
  ]
  const texto = formatearNotaDigital({
    code: "AB23",
    fecha: "27 nov 2026, 10:30",
    negocio: "Café Central",
    lineas,
    total: totalDeLineas(lineas),
  })
  assert.match(texto, /\*Nota Digital — Café Central\*/)
  assert.match(texto, /Folio: \*AB23\*/)
  assert.match(texto, /2 pieza × Capuchino grande — \$55\.00 c\/u — \$110\.00/)
  assert.match(texto, /\*TOTAL: \$145\.00 MXN\*/)
})

check("cantidadTexto quita ceros decimales sobrantes", () => {
  assert.equal(cantidadTexto(1), "1")
  assert.equal(cantidadTexto(1.5), "1.5")
  assert.equal(cantidadTexto(1.25), "1.25")
})

check("la nota trunca el desglose pero SIEMPRE conserva el total", () => {
  const lineas = Array.from({ length: 60 }, (_, index) =>
    linea(`SKU-${index}`, `Artículo con nombre largo número ${index}`, 10, 1)
  )
  const texto = formatearNotaDigital({
    code: "CD45",
    fecha: "27 nov 2026",
    negocio: "Miscelánea",
    lineas,
    total: 600,
  })
  assert.ok(texto.length <= NOTA_TEXTO_MAX)
  assert.match(texto, /\*TOTAL: \$600\.00 MXN\*/)
  assert.match(texto, /renglón\(es\) más/)
})

/* ---------------------- solicitud y concepto libre ------------------------- */

check("notaDigitalRequestText incluye el código de 4 y el importe", () => {
  assert.equal(
    notaDigitalRequestText("AB23", 145),
    "Solicito pagar mi nota digital AB23 por $145.00 MXN"
  )
})

check("el código de la solicitud de nota se extrae como token", () => {
  assert.deepEqual(
    findPaymentOrderCodeTokens(notaDigitalRequestText("AB23", 145)),
    ["AB23"]
  )
})

check("un importe con forma de código no se confunde con el folio", () => {
  const tokens = findPaymentOrderCodeTokens(notaDigitalRequestText("AB23", 2345))
  assert.deepEqual(tokens, ["AB23"])
})

check("sugiereConceptoDePago: solo el link sugiere concepto (el concepto es libre en todos)", () => {
  assert.equal(sugiereConceptoDePago({ origin: "link" }), true)
  assert.equal(sugiereConceptoDePago({ origin: "qr" }), false)
  assert.equal(sugiereConceptoDePago({ origin: "nota" }), false)
})

console.log(`\n${passed} pruebas de Nota Digital OK`)
