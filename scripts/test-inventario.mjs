/**
 * Pruebas de la lógica pura del módulo Inventario (src/lib/inventario.ts):
 * parser de cantidades tolerante (hasta 3 decimales, rechaza ambiguas),
 * formateo con signo, validación de fechas ISO, estados de caducidad por
 * día calendario, validación de alta/edición de lotes y de movimientos
 * (entrada/salida/ajuste con conteo físico), versiones del CAS y mappers de
 * filas. Corre con Node directo (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-inventario.mjs
 */
import assert from "node:assert/strict"

import {
  INVENTARIO_CANTIDAD_MAX,
  INVENTARIO_DIAS_POR_VENCER,
  INVENTARIO_LOTE_MAX,
  condicionEtiqueta,
  diasParaVencer,
  estadoCaducidad,
  formatearCantidad,
  formatearDelta,
  formatearFecha,
  hoyIsoCdmx,
  kindEtiqueta,
  loteDeRow,
  movimientoDeRow,
  parsearCantidad,
  parsearCondicion,
  parsearFechaIso,
  validarLoteInput,
  validarLoteMetaInput,
  validarMovimientoInput,
  validarVersion,
} from "../src/lib/inventario.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

const UUID = "0f0e9d8c-7b6a-4f5e-8a9b-0c1d2e3f4a5b"

/* ----------------------------- parsearCantidad ---------------------------- */

check("cantidad entera, decimal con punto y con coma", () => {
  assert.equal(parsearCantidad("12"), 12)
  assert.equal(parsearCantidad("12.5"), 12.5)
  assert.equal(parsearCantidad("12,5"), 12.5)
  assert.equal(parsearCantidad("12,50"), 12.5)
  assert.equal(parsearCantidad("0.001"), 0.001)
})

check("cantidad con miles explícitos", () => {
  assert.equal(parsearCantidad("1,234.5"), 1234.5)
  assert.equal(parsearCantidad("1.234,5"), 1234.5)
  assert.equal(parsearCantidad("1,234"), 1234)
  // La coma con grupos de 3 es MILES (convención del catálogo): «12,345»
  // → 12345; la forma decimal se escribe «12,5» o «12.5».
  assert.equal(parsearCantidad("12,345"), 12345)
})

check("con cero inicial jamás hay ambigüedad de miles", () => {
  assert.equal(parsearCantidad("0.500"), 0.5)
  assert.equal(parsearCantidad("0,500"), 0.5)
  assert.equal(parsearCantidad("0.05"), 0.05)
})

check("cantidad ambigua o inválida da null", () => {
  assert.equal(parsearCantidad("12.345"), null) // ¿12.345 o doce mil?
  assert.equal(parsearCantidad("1.234.567"), null)
  assert.equal(parsearCantidad("1.2345"), null) // 4 decimales
  assert.equal(parsearCantidad("1,2345"), null)
  assert.equal(parsearCantidad("-5"), null)
  assert.equal(parsearCantidad(""), null)
  assert.equal(parsearCantidad("abc"), null)
  assert.equal(parsearCantidad(null), null)
})

check("cantidad numérica directa", () => {
  assert.equal(parsearCantidad(2.5), 2.5)
  assert.equal(parsearCantidad(Number.NaN), null)
})

/* --------------------------------- formato -------------------------------- */

check("formatearCantidad sin ceros finales", () => {
  assert.equal(formatearCantidad(1500), "1,500")
  assert.equal(formatearCantidad(2.5), "2.5")
  assert.equal(formatearCantidad(0.001), "0.001")
  assert.equal(formatearCantidad(1200.5), "1,200.5")
  assert.equal(formatearCantidad(0), "0")
})

check("formatearDelta con signo explícito", () => {
  assert.equal(formatearDelta(3), "+3")
  assert.equal(formatearDelta(-2.5), "-2.5")
})

/* ------------------------------- caducidad ------------------------------- */

check("fecha ISO válida y casos inválidos", () => {
  assert.equal(parsearFechaIso("2026-03-12"), "2026-03-12")
  assert.equal(parsearFechaIso("2028-02-29"), "2028-02-29") // bisiesto
  assert.equal(parsearFechaIso("2026-13-01"), null)
  assert.equal(parsearFechaIso("2026-02-30"), null)
  assert.equal(parsearFechaIso("2026-02-29"), null) // no bisiesto
  assert.equal(parsearFechaIso("1999-12-31"), null) // fuera del rango del CHECK
  assert.equal(parsearFechaIso("2026-1-1"), null)
  assert.equal(parsearFechaIso(42), null)
})

check("hoyIsoCdmx tiene forma AAAA-MM-DD", () => {
  assert.match(hoyIsoCdmx(), /^\d{4}-\d{2}-\d{2}$/)
})

check("diasParaVencer cuenta días calendario", () => {
  assert.equal(diasParaVencer("2026-11-28", "2026-11-28"), 0)
  assert.equal(diasParaVencer("2026-11-29", "2026-11-28"), 1)
  assert.equal(diasParaVencer("2026-11-27", "2026-11-28"), -1)
  // Cruce de mes y de año.
  assert.equal(diasParaVencer("2026-12-01", "2026-11-28"), 3)
  assert.equal(diasParaVencer("2027-01-01", "2026-12-28"), 4)
})

check("estadoCaducidad: vencido / por vencer (hoy incluido) / ok", () => {
  const hoy = "2026-11-28"
  assert.equal(estadoCaducidad("2026-11-27", hoy), "vencido")
  assert.equal(estadoCaducidad("2026-11-28", hoy), "por_vencer") // vence HOY
  assert.equal(
    estadoCaducidad("2026-11-28", "2026-10-29"),
    "por_vencer"
  )
  const limite = new Date(`${hoy}T00:00:00Z`)
  limite.setUTCDate(limite.getUTCDate() + INVENTARIO_DIAS_POR_VENCER)
  const limiteIso = limite.toISOString().slice(0, 10)
  assert.equal(estadoCaducidad(limiteIso, hoy), "por_vencer") // día 30 inclusive
  const fuera = new Date(limite)
  fuera.setUTCDate(fuera.getUTCDate() + 1)
  assert.equal(estadoCaducidad(fuera.toISOString().slice(0, 10), hoy), "ok")
})

check("formatearFecha corta determinista", () => {
  const texto = formatearFecha("2026-03-12")
  assert.match(texto, /2026/)
  assert.match(texto.toLowerCase(), /mar/)
})

/* ------------------------- condición y kind (labels) ----------------------- */

check("condicionEtiqueta y default de parsearCondicion", () => {
  assert.equal(condicionEtiqueta("nuevo"), "Nuevo")
  assert.equal(condicionEtiqueta("usado"), "Usado")
  assert.equal(condicionEtiqueta("danado"), "Dañado")
  assert.equal(parsearCondicion("danado"), "danado")
  assert.equal(parsearCondicion("DESCONOCIDO"), "nuevo")
  assert.equal(parsearCondicion(undefined), "nuevo")
})

check("kindEtiqueta", () => {
  assert.equal(kindEtiqueta("entrada"), "Entrada")
  assert.equal(kindEtiqueta("salida"), "Salida")
  assert.equal(kindEtiqueta("ajuste"), "Ajuste")
})

/* ----------------------------- validarLoteInput --------------------------- */

check("alta mínima válida: defaults sanos", () => {
  const alta = validarLoteInput({ articuloId: UUID })
  assert.equal(alta.ok, true)
  if (!alta.ok) return
  assert.equal(alta.lote.articuloId, UUID)
  assert.equal(alta.lote.lote, null)
  assert.equal(alta.lote.caducidad, null)
  assert.equal(alta.lote.condicion, "nuevo")
  assert.equal(alta.lote.ubicacion, null)
  assert.equal(alta.lote.cantidadInicial, 0)
})

check("alta completa valida y normaliza", () => {
  const alta = validarLoteInput({
    articuloId: UUID,
    lote: "  L-2026-A  ",
    caducidad: "2027-06-30",
    condicion: "usado",
    ubicacion: " Bodega A, anaquel 3 ",
    cantidadInicial: "1,250.500",
  })
  assert.equal(alta.ok, true)
  if (!alta.ok) return
  assert.equal(alta.lote.lote, "L-2026-A")
  assert.equal(alta.lote.caducidad, "2027-06-30")
  assert.equal(alta.lote.condicion, "usado")
  assert.equal(alta.lote.ubicacion, "Bodega A, anaquel 3")
  assert.equal(alta.lote.cantidadInicial, 1250.5)
})

check("alta exige artículo con forma de uuid", () => {
  const sin = validarLoteInput({})
  assert.equal(sin.ok, false)
  if (!sin.ok) {
    assert.equal(sin.code, "articulo_invalido")
    assert.equal(sin.campo, "articuloId")
  }
  const mal = validarLoteInput({ articuloId: "no-es-uuid" })
  assert.equal(mal.ok, false)
})

check("alta rechaza lote largo, caducidad inválida y cantidad inválida", () => {
  assert.equal(
    validarLoteInput({ articuloId: UUID, lote: "x".repeat(INVENTARIO_LOTE_MAX + 1) })
      .ok,
    false
  )
  const caducidad = validarLoteInput({
    articuloId: UUID,
    caducidad: "2026-02-30",
  })
  assert.equal(caducidad.ok, false)
  if (!caducidad.ok) assert.equal(caducidad.code, "caducidad_invalida")
  const cantidad = validarLoteInput({
    articuloId: UUID,
    cantidadInicial: "1.2.3",
  })
  assert.equal(cantidad.ok, false)
  if (!cantidad.ok) assert.equal(cantidad.code, "cantidad_invalida")
})

check("alta acepta cantidad inicial en cero (lote preparado)", () => {
  const alta = validarLoteInput({ articuloId: UUID, cantidadInicial: 0 })
  assert.equal(alta.ok, true)
})

/* --------------------------- validarLoteMetaInput -------------------------- */

check("meta valida sin articuloId ni cantidad", () => {
  const meta = validarLoteMetaInput({
    lote: "L-9",
    caducidad: "",
    condicion: "danado",
    ubicacion: "Mostrador",
  })
  assert.equal(meta.ok, true)
  if (!meta.ok) return
  assert.equal(meta.meta.lote, "L-9")
  assert.equal(meta.meta.caducidad, null) // vacío = sin caducidad
  assert.equal(meta.meta.condicion, "danado")
  assert.equal(meta.meta.ubicacion, "Mostrador")
})

check("meta rechaza caducidad inválida", () => {
  const meta = validarLoteMetaInput({ caducidad: "31/12/2027" })
  assert.equal(meta.ok, false)
  if (!meta.ok) assert.equal(meta.code, "caducidad_invalida")
})

/* -------------------------- validarMovimientoInput ------------------------- */

check("entrada/salida piden magnitud positiva", () => {
  const entrada = validarMovimientoInput({ kind: "entrada", cantidad: "3" })
  assert.equal(entrada.ok, true)
  if (entrada.ok) assert.equal(entrada.movimiento.cantidad, 3)
  const salida = validarMovimientoInput({ kind: "salida", cantidad: "2,5" })
  assert.equal(salida.ok, true)
  if (salida.ok) assert.equal(salida.movimiento.cantidad, 2.5)
  const cero = validarMovimientoInput({ kind: "entrada", cantidad: "0" })
  assert.equal(cero.ok, false)
  const negativa = validarMovimientoInput({ kind: "salida", cantidad: "-2" })
  assert.equal(negativa.ok, false)
})

check("ajuste pide el conteo físico (objetivo absoluto)", () => {
  const ajuste = validarMovimientoInput({
    kind: "ajuste",
    cantidadObjetivo: "0",
  })
  assert.equal(ajuste.ok, true) // dejar el lote en CERO es un ajuste válido
  if (ajuste.ok) assert.equal(ajuste.movimiento.cantidadObjetivo, 0)
  const sinObjetivo = validarMovimientoInput({ kind: "ajuste" })
  assert.equal(sinObjetivo.ok, false)
})

check("kind desconocido, motivo largo y motivo recortado", () => {
  const kind = validarMovimientoInput({ kind: "devolucion", cantidad: "1" })
  assert.equal(kind.ok, false)
  if (!kind.ok) assert.equal(kind.code, "kind_invalido")
  const motivo = validarMovimientoInput({
    kind: "entrada",
    cantidad: "1",
    motivo: "x".repeat(201),
  })
  assert.equal(motivo.ok, false)
  if (!motivo.ok) assert.equal(motivo.code, "motivo_invalido")
  const limpio = validarMovimientoInput({
    kind: "entrada",
    cantidad: "1",
    motivo: "  Compra del proveedor  ",
  })
  assert.equal(limpio.ok, true)
  if (limpio.ok) assert.equal(limpio.movimiento.motivo, "Compra del proveedor")
})

/* ------------------------------- validarVersion ---------------------------- */

check("version del CAS", () => {
  assert.equal(validarVersion("7"), 7)
  assert.equal(validarVersion(0), null)
  assert.equal(validarVersion("x"), null)
  assert.equal(validarVersion(2.5), null)
})

/* --------------------------- borde del tope numeric ------------------------ */

check("tope alineado al máximo físico de numeric(12,3)", () => {
  // numeric(12,3) = 9 dígitos enteros + 3 decimales: 1e9 desbordaría (22003)
  // aunque un CHECK <= 1e9 existiera, así que el tope efectivo es el máximo
  // de la columna.
  assert.equal(INVENTARIO_CANTIDAD_MAX, 999999999.999)
})

check("cantidad en el borde del tope pasa; por encima da 422", () => {
  const limite = validarLoteInput({
    articuloId: UUID,
    cantidadInicial: "999999999.99",
  })
  assert.equal(limite.ok, true)
  if (limite.ok) assert.equal(limite.lote.cantidadInicial, 999999999.99)
  const fuera = validarLoteInput({
    articuloId: UUID,
    cantidadInicial: "1000000000",
  })
  assert.equal(fuera.ok, false)
  if (!fuera.ok) assert.equal(fuera.code, "cantidad_invalida")
})

check("movimientos en el borde del tope", () => {
  const entrada = validarMovimientoInput({
    kind: "entrada",
    cantidad: "999999999.99",
  })
  assert.equal(entrada.ok, true)
  const ajuste = validarMovimientoInput({
    kind: "ajuste",
    cantidadObjetivo: "999999999.99",
  })
  assert.equal(ajuste.ok, true)
  const salidaFuera = validarMovimientoInput({
    kind: "entrada",
    cantidad: "999999999.999",
  })
  // «999999999.999» con un solo punto es AMBIGUO (¿decimales o miles?) — el
  // parser lo rechaza por convención; nunca llega al borde.
  assert.equal(salidaFuera.ok, false)
  const objetivoFuera = validarMovimientoInput({
    kind: "ajuste",
    cantidadObjetivo: "1000000000",
  })
  assert.equal(objetivoFuera.ok, false)
})

/* --------------------------------- mappers -------------------------------- */

check("loteDeRow mapea la fila completa", () => {
  const ahora = new Date("2026-11-28T15:30:00.000Z")
  const row = {
    id: UUID,
    articulo_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    lote: "L-1",
    caducidad: "2027-01-31",
    condicion: "usado",
    ubicacion: "Bodega",
    cantidad: "12.5",
    version: 3,
    created_at: ahora,
    updated_at: ahora,
    sku: "PROD-1",
    nombre: "Capuchino",
    um: "pieza",
  }
  const lote = loteDeRow(row)
  assert.equal(lote.id, UUID)
  assert.equal(lote.caducidad, "2027-01-31")
  assert.equal(lote.condicion, "usado")
  assert.equal(lote.cantidad, 12.5)
  assert.equal(lote.version, 3)
  assert.equal(lote.sku, "PROD-1")
  assert.equal(lote.createdAt, ahora.toISOString())
})

check("loteDeRow tolera nulos", () => {
  const lote = loteDeRow({
    id: UUID,
    articulo_id: UUID,
    lote: null,
    caducidad: null,
    condicion: "otro",
    ubicacion: null,
    cantidad: 0,
    version: 1,
    created_at: "2026-11-28T00:00:00.000Z",
    updated_at: "2026-11-28T00:00:00.000Z",
  })
  assert.equal(lote.lote, null)
  assert.equal(lote.caducidad, null)
  assert.equal(lote.condicion, "nuevo") // valor fuera de lista → default
  assert.equal(lote.ubicacion, null)
})

check("movimientoDeRow mapea el kardex", () => {
  const mov = movimientoDeRow({
    id: UUID,
    lote_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    articulo_id: UUID,
    kind: "salida",
    delta: "-3",
    cantidad_antes: "10",
    cantidad_despues: "7",
    motivo: "Venta mostrador",
    created_at: new Date("2026-11-28T18:00:00.000Z"),
    sku: "PROD-1",
    nombre: "Capuchino",
    lote: "L-1",
  })
  assert.equal(mov.kind, "salida")
  assert.equal(mov.delta, -3)
  assert.equal(mov.cantidadAntes, 10)
  assert.equal(mov.cantidadDespues, 7)
  assert.equal(mov.motivo, "Venta mostrador")
  assert.equal(mov.lote, "L-1")
})

console.log(`\n${passed} pruebas OK (inventario)`)
