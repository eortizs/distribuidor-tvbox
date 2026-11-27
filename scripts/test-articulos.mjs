/**
 * Pruebas de la lógica pura de Alta de Artículos/Servicios
 * (src/lib/articulos.ts): normalización de SKU/U.M., validación de la
 * entrada, parser de precios tolerante, booleanos del CSV, parser CSV
 * RFC4180 (BOM, CRLF, comillas, delimitador ';'), mapeo de cabeceras con
 * alias, detección de SKUs repetidos dentro del archivo, informe de
 * importación, plantilla y serialización. Corre con Node directo (Node 24
 * elimina tipos al importar .ts):
 *
 *   node scripts/test-articulos.mjs
 */
import assert from "node:assert/strict"

import {
  articuloDeRow,
  ARTICULO_SKU_MAX,
  CSV_HEADERS,
  detectarDelimitador,
  esArticuloIdValido,
  IMPORT_MAX_FILAS,
  leerCsvArticulos,
  mapearEncabezados,
  normalizarSku,
  normalizarTexto,
  normalizarUm,
  parsearBooleano,
  parsearPrecio,
  parsearStatus,
  patronBusqueda,
  plantillaCsv,
  serializarCsv,
  umEtiqueta,
  validarArticuloInput,
  validarVersion,
} from "../src/lib/articulos.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/* ------------------------------ normalizarSku ----------------------------- */

check("SKU se recorta y pasa a mayúsculas", () => {
  assert.equal(normalizarSku("  prod-001  "), "PROD-001")
})

check("SKU no string da vacío", () => {
  assert.equal(normalizarSku(42), "")
})

/* ----------------------------- normalizarTexto ---------------------------- */

check("texto sin acentos y en minúsculas", () => {
  assert.equal(normalizarTexto("CategorÍA Íntima"), "categoria intima")
})

/* ------------------------------- normalizarUm ----------------------------- */

check("U.M. acepta el código directo", () => {
  assert.equal(normalizarUm("pieza"), "pieza")
})

check("U.M. acepta la etiqueta con acentos y mayúsculas", () => {
  assert.equal(normalizarUm("PIEZA"), "pieza")
  assert.equal(normalizarUm("Kg"), "kg")
  assert.equal(normalizarUm("  caja  "), "caja")
})

check("U.M. texto libre válido se guarda verbatim (recortado)", () => {
  assert.equal(normalizarUm("Metro cuadrado"), "Metro cuadrado")
})

check("U.M. vacía, «otro» sin texto o demasiado larga es inválida", () => {
  assert.equal(normalizarUm(""), null)
  assert.equal(normalizarUm("   "), null)
  assert.equal(normalizarUm("otro"), null)
  assert.equal(normalizarUm("x".repeat(31)), null)
  assert.equal(normalizarUm(123), null)
})

check("etiqueta visible de la U.M.", () => {
  assert.equal(umEtiqueta("pieza"), "Pieza")
  assert.equal(umEtiqueta("Metro cuadrado"), "Metro cuadrado")
})

/* ------------------------------ parsearPrecio ----------------------------- */

check("precio con punto decimal", () => {
  assert.equal(parsearPrecio("55.00"), 55)
  assert.equal(parsearPrecio("55.5"), 55.5)
})

check("precio con coma decimal", () => {
  assert.equal(parsearPrecio("55,50"), 55.5)
  assert.equal(parsearPrecio("0,99"), 0.99)
})

check("precio con miles por coma y punto decimal", () => {
  assert.equal(parsearPrecio("1,234.50"), 1234.5)
  assert.equal(parsearPrecio("$1,234.56"), 1234.56)
})

check("precio con miles por punto y coma decimal", () => {
  assert.equal(parsearPrecio("1.234,50"), 1234.5)
})

check("precio con miles sin decimales", () => {
  assert.equal(parsearPrecio("1,234"), 1234)
})

check("precio entero y número directo", () => {
  assert.equal(parsearPrecio("55"), 55)
  assert.equal(parsearPrecio(55), 55)
  assert.equal(parsearPrecio(55.5), 55.5)
})

check("precio ambiguo o inválido da null", () => {
  assert.equal(parsearPrecio("12.345"), null) // ¿12 o 12345? Convención del repo
  assert.equal(parsearPrecio("55,555"), 55555) // miles por coma: no ambiguo
  assert.equal(parsearPrecio("1.2.3"), null)
  assert.equal(parsearPrecio("-5"), null)
  assert.equal(parsearPrecio("abc"), null)
  assert.equal(parsearPrecio(""), null)
  assert.equal(parsearPrecio("   "), null)
  assert.equal(parsearPrecio(Number.NaN), null)
})

/* ----------------------------- parsearBooleano ---------------------------- */

check("booleanos afirmativos del CSV", () => {
  assert.equal(parsearBooleano("si", true), true)
  assert.equal(parsearBooleano("SÍ", true), true)
  assert.equal(parsearBooleano("true", true), true)
  assert.equal(parsearBooleano("1", true), true)
  assert.equal(parsearBooleano("verdadero", true), true)
  assert.equal(parsearBooleano(true, true), true)
  assert.equal(parsearBooleano(1, true), true)
})

check("booleanos negativos del CSV", () => {
  assert.equal(parsearBooleano("no", true), false)
  assert.equal(parsearBooleano("false", true), false)
  assert.equal(parsearBooleano("0", true), false)
  assert.equal(parsearBooleano(false, true), false)
  assert.equal(parsearBooleano(0, true), false)
})

check("booleano vacío toma el fallback y lo desconocido da null", () => {
  assert.equal(parsearBooleano("", true), true)
  assert.equal(parsearBooleano(undefined, false), false)
  assert.equal(parsearBooleano("quizás", true), null)
  assert.equal(parsearBooleano("tal vez", true), null)
})

/* --------------------------- validarArticuloInput ------------------------- */

function entradaValida() {
  return {
    sku: "prod-001",
    nombre: "  Capuchino grande  ",
    descripcion: "  Café con leche  ",
    um: "Pieza",
    precioUnitario: "55.50",
    categoria: " Bebidas ",
    disponible: "si",
  }
}

check("entrada válida se normaliza completa", () => {
  const validacion = validarArticuloInput(entradaValida())
  assert.equal(validacion.ok, true)
  if (validacion.ok) {
    assert.deepEqual(validacion.articulo, {
      sku: "PROD-001",
      nombre: "Capuchino grande",
      descripcion: "Café con leche",
      um: "pieza",
      precioUnitario: 55.5,
      categoria: "Bebidas",
      disponible: true,
    })
  }
})

check("SKU vacío o demasiado largo es inválido", () => {
  const sinSku = { ...entradaValida(), sku: "   " }
  const v1 = validarArticuloInput(sinSku)
  assert.equal(v1.ok, false)
  if (!v1.ok) {
    assert.equal(v1.code, "sku_invalido")
    assert.equal(v1.campo, "sku")
  }
  const largo = { ...entradaValida(), sku: "x".repeat(ARTICULO_SKU_MAX + 1) }
  const v2 = validarArticuloInput(largo)
  assert.equal(v2.ok, false)
})

check("nombre vacío o demasiado largo es inválido", () => {
  const vacio = { ...entradaValida(), nombre: "" }
  const v1 = validarArticuloInput(vacio)
  assert.equal(v1.ok, false)
  if (!v1.ok) assert.equal(v1.code, "nombre_invalido")
  const largo = { ...entradaValida(), nombre: "x".repeat(121) }
  const v2 = validarArticuloInput(largo)
  assert.equal(v2.ok, false)
})

check("descripción demasiado larga es inválida", () => {
  const v = validarArticuloInput({
    ...entradaValida(),
    descripcion: "x".repeat(2001),
  })
  assert.equal(v.ok, false)
  if (!v.ok) assert.equal(v.code, "descripcion_invalida")
})

check("U.M. inválida es rechazada con su campo", () => {
  const v = validarArticuloInput({ ...entradaValida(), um: "otro" })
  assert.equal(v.ok, false)
  if (!v.ok) {
    assert.equal(v.code, "um_invalida")
    assert.equal(v.campo, "um")
  }
})

check("precio inválido o fuera de tope es rechazado", () => {
  const v1 = validarArticuloInput({ ...entradaValida(), precioUnitario: "abc" })
  assert.equal(v1.ok, false)
  if (!v1.ok) assert.equal(v1.code, "precio_invalido")
  const v2 = validarArticuloInput({ ...entradaValida(), precioUnitario: 0 })
  assert.equal(v2.ok, true) // 0 es válido (muestra/obsequio)
  const v3 = validarArticuloInput({ ...entradaValida(), precioUnitario: 1000001 })
  assert.equal(v3.ok, false)
  if (!v3.ok) assert.equal(v3.code, "precio_invalido")
})

check("categoría opcional: vacía es null y larga es inválida", () => {
  const v1 = validarArticuloInput({ ...entradaValida(), categoria: "" })
  assert.equal(v1.ok, true)
  if (v1.ok) assert.equal(v1.articulo.categoria, null)
  const v2 = validarArticuloInput({ ...entradaValida(), categoria: "x".repeat(61) })
  assert.equal(v2.ok, false)
  if (!v2.ok) assert.equal(v2.code, "categoria_invalida")
})

check("disponible inválido es rechazado", () => {
  const v = validarArticuloInput({ ...entradaValida(), disponible: "quizás" })
  assert.equal(v.ok, false)
  if (!v.ok) assert.equal(v.code, "disponible_invalido")
})

check("cuerpo que no es objeto es inválido", () => {
  assert.equal(validarArticuloInput(null).ok, false)
  assert.equal(validarArticuloInput("texto").ok, false)
  assert.equal(validarArticuloInput([1]).ok, false)
})

/* ------------------------------ validarVersion ---------------------------- */

check("versión entera positiva es válida", () => {
  assert.equal(validarVersion("3"), 3)
  assert.equal(validarVersion(12), 12)
  assert.equal(validarVersion("0"), null)
  assert.equal(validarVersion("x"), null)
  assert.equal(validarVersion(1.5), null)
})

check("status solo acepta active/archived", () => {
  assert.equal(parsearStatus("archived"), "archived")
  assert.equal(parsearStatus("active"), "active")
  assert.equal(parsearStatus("otro"), null)
})

/* ------------------------------ esArticuloIdValido ------------------------ */

check("id con forma de uuid es válido", () => {
  assert.equal(
    esArticuloIdValido("123e4567-e89b-12d3-a456-426614174000"),
    true
  )
  assert.equal(esArticuloIdValido("no-soy-uuid"), false)
  assert.equal(esArticuloIdValido(42), false)
})

/* -------------------------------- articuloDeRow --------------------------- */

check("row de Postgres se serializa a la forma de la API", () => {
  const ahora = new Date("2026-11-27T12:00:00Z")
  const articulo = articuloDeRow({
    id: "123e4567-e89b-12d3-a456-426614174000",
    sku: "PROD-001",
    nombre: "Capuchino",
    descripcion: "",
    um: "pieza",
    precio_unitario: "55.50",
    categoria: null,
    disponible: true,
    status: "active",
    version: 4,
    created_at: ahora,
    updated_at: ahora,
  })
  assert.equal(articulo.precioUnitario, 55.5)
  assert.equal(articulo.categoria, null)
  assert.equal(articulo.version, 4)
  assert.equal(articulo.status, "active")
  assert.equal(articulo.createdAt, ahora.toISOString())
})

check("row archivada mantiene su estado", () => {
  const articulo = articuloDeRow({
    id: "123e4567-e89b-12d3-a456-426614174000",
    status: "archived",
    disponible: false,
    precio_unitario: 10,
    version: 2,
  })
  assert.equal(articulo.status, "archived")
  assert.equal(articulo.disponible, false)
})

/* ------------------------------ patronBusqueda ---------------------------- */

check("patrón de búsqueda escapa comodines ILIKE", () => {
  assert.equal(patronBusqueda("50% off"), "%50\\% off%")
  assert.equal(patronBusqueda("a_b"), "%a\\_b%")
})

/* ---------------------------- detectarDelimitador ------------------------- */

check("delimitador por mayoría fuera de comillas", () => {
  assert.equal(detectarDelimitador('sku,nombre,"a,b"\n1,2,3'), ",")
  assert.equal(detectarDelimitador('sku;nombre;"a;b"\n1;2;3'), ";")
  assert.equal(detectarDelimitador("sin separadores"), ",")
})

/* ----------------------------- mapearEncabezados -------------------------- */

check("cabeceras canónicas mapean por posición", () => {
  const mapeo = mapearEncabezados([...CSV_HEADERS])
  assert.equal(mapeo.ok, true)
  if (mapeo.ok) {
    assert.equal(mapeo.mapa.length, CSV_HEADERS.length)
    const sku = mapeo.mapa.find((m) => m.campo === "sku")
    assert.equal(sku.indice, 0)
  }
})

check("alias y acentos de cabeceras se resuelven", () => {
  const mapeo = mapearEncabezados([
    "SKU",
    "Producto",
    "Descripción",
    "Unidad de medida",
    "P.U.",
    "Categoría",
    "Disponible",
  ])
  assert.equal(mapeo.ok, true)
  if (mapeo.ok) {
    const porCampo = new Map(mapeo.mapa.map((m) => [m.campo, m.indice]))
    assert.equal(porCampo.get("descripcion"), 2)
    assert.equal(porCampo.get("um"), 3)
    assert.equal(porCampo.get("precio_unitario"), 4)
  }
})

check("cabecera obligatoria faltante es error de archivo", () => {
  const mapeo = mapearEncabezados(["sku", "nombre", "um"])
  assert.equal(mapeo.ok, false)
  if (!mapeo.ok) assert.match(mapeo.error, /precio_unitario/)
})

check("cabecera duplicada es error de archivo", () => {
  const mapeo = mapearEncabezados([
    "sku",
    "nombre",
    "descripcion",
    "um",
    "precio",
    "categoria",
    "disponible",
    "sku",
  ])
  assert.equal(mapeo.ok, false)
  if (!mapeo.ok) assert.match(mapeo.error, /repetidas/)
})

check("cabeceras desconocidas se ignoran y las opcionales pueden faltar", () => {
  const mapeo = mapearEncabezados([
    "sku",
    "nombre",
    "nota_extra",
    "um",
    "precio_unitario",
  ])
  assert.equal(mapeo.ok, true)
  if (mapeo.ok) assert.equal(mapeo.mapa.length, 4)
})

/* ----------------------------- leerCsvArticulos --------------------------- */

const CSV_VALIDO = [
  "sku,nombre,descripcion,um,precio_unitario,categoria,disponible",
  'PROD-001,Capuchino grande,"Café, con leche y ""vapor""",pieza,55.00,Bebidas,si',
  "PROD-002,Molino manual,Molino de acero,pieza,850.00,Equipo,no",
].join("\r\n")

check("CSV válido produce informe limpio y artículos normalizados", () => {
  const lectura = leerCsvArticulos(CSV_VALIDO)
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.informe.total, 2)
    assert.equal(lectura.informe.errores, 0)
    assert.equal(lectura.validas.length, 2)
    assert.equal(lectura.validas[0].sku, "PROD-001")
    assert.equal(lectura.validas[0].precioUnitario, 55)
    assert.equal(lectura.validas[1].disponible, false)
    assert.equal(lectura.validas[0].descripcion, 'Café, con leche y "vapor"')
  }
})

check("CSV con BOM se lee igual", () => {
  const lectura = leerCsvArticulos(`\uFEFF${CSV_VALIDO}`)
  assert.equal(lectura.ok, true)
  if (lectura.ok) assert.equal(lectura.informe.total, 2)
})

check("CSV con delimitador ';' se detecta solo", () => {
  const csv = CSV_VALIDO.split(",").join(";")
  const lectura = leerCsvArticulos(csv)
  assert.equal(lectura.ok, true)
  if (lectura.ok) assert.equal(lectura.validas.length, 2)
})

check("campo con salto de línea entre comillas no parte la fila", () => {
  const csv = [
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible",
    'PROD-001,"Café\nen grano","dos\nlíneas",pieza,55.00,,si',
  ].join("\r\n")
  const lectura = leerCsvArticulos(csv)
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.informe.total, 1)
    assert.equal(lectura.validas[0].nombre, "Café\nen grano")
    assert.equal(lectura.validas[0].categoria, null)
  }
})

check("fila con error va al informe y no se valida el lote", () => {
  const csv = [
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible",
    "PROD-001,Capuchino,,pieza,55.00,Bebidas,si",
    "PROD-002,Molino,,pieza,diez,Equipo,si",
  ].join("\r\n")
  const lectura = leerCsvArticulos(csv)
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.informe.errores, 1)
    assert.equal(lectura.validas.length, 1)
    assert.equal(lectura.informe.filas[0].fila, 2)
    assert.equal(lectura.informe.filas[0].campo, "precioUnitario")
    assert.equal(lectura.informe.filas[0].sku, "PROD-002")
  }
})

check("SKU repetido dentro del archivo es error de fila", () => {
  const csv = [
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible",
    "PROD-001,Capuchino,,pieza,55,Bebidas,si",
    "prod-001,Duplicado,,pieza,60,Bebidas,si",
  ].join("\r\n")
  const lectura = leerCsvArticulos(csv)
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.informe.errores, 1)
    assert.match(lectura.informe.filas[0].motivo, /repetido/)
  }
})

check("disponible vacío toma el default (sí)", () => {
  const csv = [
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible",
    "PROD-001,Capuchino,,pieza,55,Bebidas,",
  ].join("\r\n")
  const lectura = leerCsvArticulos(csv)
  assert.equal(lectura.ok, true)
  if (lectura.ok) assert.equal(lectura.validas[0].disponible, true)
})

check("archivo vacío, sin cabecera válida o sin renglones da error", () => {
  assert.equal(leerCsvArticulos("").ok, false)
  assert.equal(leerCsvArticulos("   \r\n").ok, false)
  const soloCabecera =
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible"
  const lectura = leerCsvArticulos(soloCabecera)
  assert.equal(lectura.ok, false)
  if (!lectura.ok) assert.match(lectura.error, /no tiene renglones/)
  const sinColumnas = leerCsvArticulos("hola,mundo\n1,2")
  assert.equal(sinColumnas.ok, false)
  if (!sinColumnas.ok) assert.match(sinColumnas.error, /Faltan columnas/)
})

check("archivo con demasiadas filas da error de archivo", () => {
  const cabecera =
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible"
  const filas = Array.from(
    { length: IMPORT_MAX_FILAS + 1 },
    (_, i) => `SKU-${i},Nombre,,pieza,10,,si`
  )
  const lectura = leerCsvArticulos([cabecera, ...filas].join("\r\n"))
  assert.equal(lectura.ok, false)
  if (!lectura.ok) assert.match(lectura.error, /tope/)
})

check("fila con columnas de menos produce errores por campo faltante", () => {
  const csv = [
    "sku,nombre,descripcion,um,precio_unitario,categoria,disponible",
    "PROD-001,Capuchino",
  ].join("\r\n")
  const lectura = leerCsvArticulos(csv)
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.informe.errores, 1)
    assert.equal(lectura.validas.length, 0)
  }
})

/* ------------------------------- plantillaCsv ----------------------------- */

check("la plantilla empieza con BOM y se relee sin errores", () => {
  const plantilla = plantillaCsv()
  assert.ok(plantilla.startsWith("\uFEFF"))
  const lectura = leerCsvArticulos(plantilla)
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.informe.total, 1)
    assert.equal(lectura.informe.errores, 0)
    assert.equal(lectura.validas[0].sku, "PROD-001")
  }
})

/* ------------------------------- serializarCsv ---------------------------- */

check("serializar escapa comillas, delimitador y saltos", () => {
  const csv = serializarCsv([
    ["a", 'con "comillas"', "con, coma", "con\nsalto"],
  ])
  assert.equal(csv, 'a,"con ""comillas""","con, coma","con\nsalto"')
})

check("serializar y leer hacen round-trip", () => {
  const original = [["PROD-001", 'Nombre "raro", sí', "desc", "pieza", "55.00", "", "si"]]
  const csv = serializarCsv(original)
  const lectura = leerCsvArticulos(
    `sku,nombre,descripcion,um,precio_unitario,categoria,disponible\r\n${csv}`
  )
  assert.equal(lectura.ok, true)
  if (lectura.ok) {
    assert.equal(lectura.validas[0].nombre, 'Nombre "raro", sí')
  }
})

console.log(`\n${passed} pruebas OK`)
