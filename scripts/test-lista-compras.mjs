/**
 * Pruebas de la lógica pura de Lista de compras (src/lib/lista-compras.ts):
 * normalización de nombres, unidades y cantidades, aplicación de operaciones
 * (agregar, actualizar, eliminar, marcar, reemplazar, vaciar), duplicados,
 * sumas compatibles e incompatibles, preservación de comprados, agrupación,
 * confirmación destructiva y validación de entradas. Corre con Node directo
 * (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-lista-compras.mjs
 */
import assert from "node:assert/strict"

import {
  agruparPorCategoria,
  aplicarOperaciones,
  capitalizarPrimeraLetra,
  contarPendientes,
  formatCantidad,
  MAX_CANTIDAD,
  normalizarCategoria,
  requiereConfirmacion,
  validarOperacion,
  validarOperaciones,
  claveProducto,
  CATEGORIA_RESPALDO,
} from "../src/lib/lista-compras.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/** Lista base con IDs estables para las pruebas. */
function base() {
  return [
    {
      id: "tomate",
      nombre: "Tomate",
      categoria: "Frutas y verduras",
      cantidad: 2,
      unidad: "kg",
      comprado: false,
      estimado: false,
    },
    {
      id: "leche",
      nombre: "Leche",
      categoria: "Lácteos y huevos",
      cantidad: null,
      unidad: null,
      comprado: false,
      estimado: false,
    },
    {
      id: "pan",
      nombre: "Pan",
      categoria: "Panadería y tortillería",
      cantidad: null,
      unidad: null,
      comprado: true,
      estimado: false,
    },
  ]
}

const ok = (items, ops) => {
  const resultado = aplicarOperaciones(items, ops)
  assert.equal(resultado.ok, true)
  return resultado.items
}

/* ------------------------------ claveProducto ---------------------------- */

check("claveProducto ignora acentos, signos y mayúsculas", () => {
  assert.equal(claveProducto("  ¡Tortilla de Maíz! "), claveProducto("tortilla de maíz"))
  assert.equal(claveProducto("Leche Deslactosada"), claveProducto("leche deslactosada"))
  assert.notEqual(claveProducto("leche"), claveProducto("leche entera"))
})

/* --------------------------- validación de ops --------------------------- */

check("validarOperacion rechaza formas inválidas", () => {
  assert.equal(validarOperacion(null), null)
  assert.equal(validarOperacion({ tipo: "agregar" }), null)
  assert.equal(validarOperacion({ tipo: "agregar", nombre: "  " }), null)
  assert.equal(validarOperacion({ tipo: "agregar", nombre: "x".repeat(81) }), null)
  assert.equal(validarOperacion({ tipo: "marcar", id: "a" }), null)
  assert.equal(validarOperacion({ tipo: "eliminar" }), null)
  assert.equal(validarOperacion({ tipo: "cosa" }), null)
})

check("validarOperacion normaliza nombre, unidad y categoría", () => {
  const op = validarOperacion({
    tipo: "agregar",
    nombre: "  detergente\npara  trastes ",
    categoria: "Cosa rara",
    cantidad: 1.5,
    unidad: "litros",
  })
  assert.deepEqual(op, {
    tipo: "agregar",
    nombre: "Detergente para trastes",
    categoria: "Otros",
    cantidad: 1.5,
    unidad: "l",
  })
})

check("capitalizarPrimeraLetra respeta números y mayúsculas existentes", () => {
  assert.equal(capitalizarPrimeraLetra("tomate"), "Tomate")
  assert.equal(capitalizarPrimeraLetra("2 kg de pan"), "2 kg de pan")
  assert.equal(capitalizarPrimeraLetra("TOMATE cherry"), "TOMATE cherry")
  assert.equal(capitalizarPrimeraLetra("¡vainilla!"), "¡vainilla!")
  assert.equal(capitalizarPrimeraLetra(""), "")
})

check("validarOperacion descarta cantidades imposibles", () => {
  assert.equal(validarOperacion({ tipo: "agregar", nombre: "arroz", cantidad: 0 }), null)
  assert.equal(validarOperacion({ tipo: "agregar", nombre: "arroz", cantidad: -2 }), null)
  assert.equal(
    validarOperacion({ tipo: "agregar", nombre: "arroz", cantidad: MAX_CANTIDAD + 1 }),
    null
  )
  const op = validarOperacion({ tipo: "agregar", nombre: "arroz", cantidad: 10000.999 })
  assert.equal(op, null, "cantidad excesiva inválida toda la operación")
})

check("validarOperaciones acota la tanda y suelta lo inválido", () => {
  const ops = validarOperaciones([
    { tipo: "vaciar" },
    "basura",
    null,
    { tipo: "agregar", nombre: "atún", categoria: "Despensa" },
  ])
  assert.equal(ops.length, 2)
  assert.equal(ops[0].tipo, "vaciar")
  assert.equal(ops[1].nombre, "Atún")
})

/* ------------------------------- agregar -------------------------------- */

check("agregar crea pendiente con cantidad y unidad", () => {
  const items = ok(base(), [
    { tipo: "agregar", nombre: "Café molido", categoria: "Despensa", cantidad: 500, unidad: "g" },
  ])
  const cafe = items.find((item) => item.nombre === "Café molido")
  assert.ok(cafe)
  assert.equal(cafe.cantidad, 500)
  assert.equal(cafe.unidad, "g")
  assert.equal(cafe.comprado, false)
  assert.equal(cafe.categoria, "Despensa")
})

check("agregar sin cantidad explícita no inventa un 1", () => {
  const items = ok([], [{ tipo: "agregar", nombre: "Huevos", categoria: "Lácteos y huevos" }])
  assert.equal(items[0].cantidad, null)
  assert.equal(items[0].unidad, null)
})

check("agregar repetido no duplica ni toca cantidad; vuelve a pendiente", () => {
  const items = base()
  items[2].comprado = true // pan comprado
  const resultado = ok(items, [{ tipo: "agregar", nombre: "  pan " }])
  assert.equal(resultado.filter((item) => claveProducto(item.nombre) === "pan").length, 1)
  const pan = resultado.find((item) => claveProducto(item.nombre) === "pan")
  assert.equal(pan.comprado, false)
  assert.equal(pan.cantidad, null)
})

check("agregar con suma suma solo unidades compatibles", () => {
  const items = ok(base(), [
    { tipo: "agregar", nombre: "Tomate", suma: true, cantidad: 1, unidad: "kg" },
  ])
  let tomate = items.find((item) => item.id === "tomate")
  assert.equal(tomate.cantidad, 3)

  const incompatible = ok(base(), [
    { tipo: "agregar", nombre: "Tomate", suma: true, cantidad: 500, unidad: "g" },
  ])
  tomate = incompatible.find((item) => item.id === "tomate")
  assert.equal(tomate.cantidad, 2, "unidades incompatibles no suman")

  const sinCantidad = ok(base(), [
    { tipo: "agregar", nombre: "Leche", suma: true, cantidad: 2, unidad: "l" },
  ])
  const leche = sinCantidad.find((item) => item.id === "leche")
  assert.equal(leche.cantidad, 2, "sumar sobre null parte de cero")
  assert.equal(leche.unidad, "l")
})

check("agregar a tope de productos no explota", () => {
  const llenas = Array.from({ length: 200 }, (_, i) => ({
    id: `p${i}`,
    nombre: `Producto ${i}`,
    categoria: "Otros",
    cantidad: null,
    unidad: null,
    comprado: false,
    estimado: false,
  }))
  const items = ok(llenas, [{ tipo: "agregar", nombre: "Uno más" }])
  assert.equal(items.length, 200)
})

/* ------------------------------ actualizar ------------------------------- */

check("actualizar establece cantidad y unidad", () => {
  const items = ok(base(), [
    { tipo: "actualizar", id: "leche", cantidad: 3, unidad: "l", modoCantidad: "establecer" },
  ])
  const leche = items.find((item) => item.id === "leche")
  assert.equal(leche.cantidad, 3)
  assert.equal(leche.unidad, "l")
})

check("actualizar con sumar agrega sobre unidades iguales", () => {
  const items = ok(base(), [
    { tipo: "actualizar", id: "tomate", cantidad: 0.5, modoCantidad: "sumar", unidad: "kg" },
  ])
  assert.equal(items.find((item) => item.id === "tomate").cantidad, 2.5)

  const incompatibles = ok(base(), [
    { tipo: "actualizar", id: "tomate", cantidad: 1, modoCantidad: "sumar", unidad: "g" },
  ])
  assert.equal(incompatibles.find((item) => item.id === "tomate").cantidad, 2)
})

check("actualizar un id desconocido rechaza la tanda completa", () => {
  const resultado = aplicarOperaciones(base(), [
    { tipo: "marcar", id: "tomate", comprado: true },
    { tipo: "eliminar", id: "fantasma" },
  ])
  assert.equal(resultado.ok, false)
  assert.match(resultado.razon, /ya no está/)
})

/* ------------------------- eliminar / marcar ----------------------------- */

check("eliminar quita solo el producto pedido", () => {
  const items = ok(base(), [{ tipo: "eliminar", id: "leche" }])
  assert.equal(items.length, 2)
  assert.ok(!items.some((item) => item.id === "leche"))
})

check("marcar cambia el estado y preserva el resto", () => {
  const items = ok(base(), [
    { tipo: "marcar", id: "tomate", comprado: true },
    { tipo: "marcar", id: "pan", comprado: false },
  ])
  assert.equal(items.find((item) => item.id === "tomate").comprado, true)
  assert.equal(items.find((item) => item.id === "pan").comprado, false)
  assert.equal(items.find((item) => item.id === "leche").comprado, false)
})

/* --------------------------- reemplazar / vaciar -------------------------- */

check("reemplazar sustituye todo y no conserva comprados", () => {
  const items = ok(base(), [
    {
      tipo: "reemplazar",
      items: [
        { nombre: "Papel", categoria: "Limpieza", cantidad: 4, unidad: "pza" },
        { nombre: "Cereal", categoria: "Despensa", estimado: true },
      ],
    },
  ])
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((item) => item.nombre).sort(), ["Cereal", "Papel"])
  assert.equal(items[0].estimado || items[1].estimado, true)
})

check("vaciar deja la lista en cero", () => {
  assert.deepEqual(ok(base(), [{ tipo: "vaciar" }]), [])
})

/* --------------------------- confirmación -------------------------------- */

check("requiereConfirmacion detecta vaciar, reemplazar y eliminar", () => {
  const lista = base()
  assert.equal(requiereConfirmacion(lista, [{ tipo: "vaciar" }]), true)
  assert.equal(
    requiereConfirmacion(lista, [{ tipo: "reemplazar", items: [{ nombre: "x" }] }]),
    true
  )
  assert.equal(
    requiereConfirmacion(lista, [{ tipo: "reemplazar", items: [] }]),
    true,
    "un reemplazo vacío equivale a vaciar y pide confirmación"
  )
  assert.equal(requiereConfirmacion(lista, [{ tipo: "eliminar", id: "pan" }]), true)
  assert.equal(
    requiereConfirmacion(lista, [{ tipo: "marcar", id: "pan", comprado: true }]),
    false
  )
  assert.equal(
    requiereConfirmacion(lista, [{ tipo: "agregar", nombre: "café" }]),
    false
  )
})

check("lista vacía no pide confirmación ni para vaciar", () => {
  assert.equal(requiereConfirmacion([], [{ tipo: "vaciar" }]), false)
  assert.equal(
    requiereConfirmacion([], [{ tipo: "reemplazar", items: [{ nombre: "x" }] }]),
    false
  )
})

/* -------------------------- formato y agrupación ------------------------- */

check("formatCantidad muestra cantidad y unidad en plural", () => {
  assert.equal(formatCantidad({ cantidad: 2, unidad: "kg" }), "2 kg")
  assert.equal(formatCantidad({ cantidad: 12, unidad: "pza" }), "12 pzas")
  assert.equal(formatCantidad({ cantidad: 1, unidad: "pza" }), "1 pza")
  assert.equal(formatCantidad({ cantidad: 1.5, unidad: "l" }), "1.5 l")
  assert.equal(formatCantidad({ cantidad: 3, unidad: null }), "3")
  assert.equal(formatCantidad({ cantidad: null, unidad: "kg" }), "")
})

check("agruparPorCategoria respeta el orden canónico y omite vacías", () => {
  const items = ok([], [
    { tipo: "agregar", nombre: "Jabón", categoria: "Limpieza" },
    { tipo: "agregar", nombre: "Manzana", categoria: "Frutas y verduras" },
    { tipo: "agregar", nombre: "Cosa", categoria: "Otros" },
  ])
  const grupos = agruparPorCategoria(items)
  assert.deepEqual(
    grupos.map((grupo) => grupo.categoria),
    ["Frutas y verduras", "Limpieza", "Otros"]
  )
  assert.equal(grupos.every((grupo) => grupo.items.length >= 1), true)
})

check("contarPendientes separa comprados", () => {
  assert.deepEqual(contarPendientes(base()), { pendientes: 2, total: 3 })
})

/* ------------------------------ categoría -------------------------------- */

check("normalizarCategoria usa respaldo con inválidas", () => {
  assert.equal(normalizarCategoria("Despensa"), "Despensa")
  assert.equal(normalizarCategoria("juguetes"), CATEGORIA_RESPALDO)
  assert.equal(normalizarCategoria(42), CATEGORIA_RESPALDO)
  assert.equal(normalizarCategoria(undefined), CATEGORIA_RESPALDO)
})

/* ------------------------------- límites --------------------------------- */

check("reemplazar con demasiados ítems se rechaza en validación", () => {
  const items = Array.from({ length: 201 }, (_, i) => ({ nombre: `Producto ${i}` }))
  assert.equal(
    validarOperacion({ tipo: "reemplazar", items }),
    null,
    "más de 200 ítems no pasa la validación"
  )
})

console.log(`\n${passed} pruebas de lista de compras pasaron.`)
