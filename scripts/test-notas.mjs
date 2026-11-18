/**
 * Pruebas de la lógica pura de Notas (src/lib/notas.ts): derivación del
 * título desde la primera línea, límites de título/texto, validación de la
 * forma de la entrada, versión del compare-and-swap, ids, preview truncado,
 * patrón de búsqueda ILIKE y serialización de filas. Corre con Node directo
 * (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-notas.mjs
 */
import assert from "node:assert/strict"

import {
  deriveTitle,
  esNotaIdValido,
  notaDeRow,
  NOTA_BODY_MAX,
  NOTA_PREVIEW_CHARS,
  NOTA_TITLE_MAX,
  NOTAS_BUSQUEDA_MIN,
  patronBusqueda,
  previewBody,
  previewDeRow,
  validarNotaInput,
  validarVersion,
} from "../src/lib/notas.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/* ------------------------------ deriveTitle ------------------------------ */

check("título escrito manda tal cual", () => {
  assert.equal(deriveTitle("  Compras  ", "texto"), "Compras")
})

check("título vacío se deriva de la primera línea del texto", () => {
  assert.equal(deriveTitle("", "Primera línea\nsegunda\ntercera"), "Primera línea")
})

check("título derivado se recorta al tope de caracteres", () => {
  const larga = "x".repeat(NOTA_TITLE_MAX + 50)
  assert.equal(deriveTitle("", larga).length, NOTA_TITLE_MAX)
})

check("título escrito largo también se recorta", () => {
  const larga = "y".repeat(NOTA_TITLE_MAX + 10)
  assert.equal(deriveTitle(larga, "texto").length, NOTA_TITLE_MAX)
})

check("sin título ni texto la nota es inválida (cadena vacía)", () => {
  assert.equal(deriveTitle("   ", "  \n  "), "")
})

/* --------------------------- validarNotaInput ---------------------------- */

check("entrada válida completa", () => {
  const r = validarNotaInput({ title: "Título", body: "Texto", pinned: true })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.nota, { title: "Título", body: "Texto", pinned: true })
  }
})

check("pinned distinto de true vale false", () => {
  const r = validarNotaInput({ body: "texto", pinned: "sí" })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.nota.pinned, false)
})

check("nota sin título ni texto se rechaza como nota_vacia", () => {
  const r = validarNotaInput({ title: "  ", body: "  \n " })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "nota_vacia")
})

check("sin body el título solo alcanza para crear", () => {
  const r = validarNotaInput({ title: "Solo título" })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.nota.title, "Solo título")
})

check("título sobre el tope se rechaza", () => {
  const r = validarNotaInput({
    title: "a".repeat(NOTA_TITLE_MAX + 1),
    body: "texto",
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "nota_invalida")
})

check("texto sobre el tope se rechaza", () => {
  const r = validarNotaInput({
    body: "b".repeat(NOTA_BODY_MAX + 1),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "nota_invalida")
})

check("forma no objeto se rechaza", () => {
  for (const mala of [null, "texto", 42, [], undefined]) {
    const r = validarNotaInput(mala)
    assert.equal(r.ok, false, String(mala))
    if (!r.ok) assert.equal(r.code, "invalid_request")
  }
})

check("campos de otro tipo valen vacío", () => {
  const r = validarNotaInput({ title: 5, body: null, pinned: 1 })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "nota_vacia")
})

check("el título derivado va dentro del título sanitizado", () => {
  const r = validarNotaInput({ body: "Primera línea\nresto" })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.nota.title, "Primera línea")
})

/* ------------------------------- validarVersion --------------------------- */

check("versión entera positiva pasa", () => {
  assert.equal(validarVersion(1), 1)
  assert.equal(validarVersion("7"), 7)
})

check("versión cero, negativa o basura se rechaza", () => {
  assert.equal(validarVersion(0), null)
  assert.equal(validarVersion(-1), null)
  assert.equal(validarVersion("abc"), null)
  assert.equal(validarVersion(undefined), null)
  assert.equal(validarVersion(1.5), null)
})

/* --------------------------------- ids ----------------------------------- */

check("uuid válido pasa", () => {
  assert.equal(esNotaIdValido("b16f8e26-2f19-4a4e-9f68-5b48aa5ef6a1"), true)
})

check("id malformado se rechaza", () => {
  for (const malo of ["", "no-uuid", "123", null, undefined, 42]) {
    assert.equal(esNotaIdValido(malo), false, String(malo))
  }
})

/* --------------------------------- preview -------------------------------- */

check("el preview recorta el cuerpo al tope", () => {
  const larga = "z".repeat(NOTA_PREVIEW_CHARS + 30)
  assert.equal(previewBody(larga).length, NOTA_PREVIEW_CHARS)
})

check("el preview conserva un cuerpo corto íntegro", () => {
  assert.equal(previewBody("hola"), "hola")
})

/* ------------------------------- patronBusqueda --------------------------- */

check("el patrón envuelve el término con comodines", () => {
  assert.equal(patronBusqueda("  abono  "), "%abono%")
})

check("los comodines literales se escapan", () => {
  assert.equal(patronBusqueda("50%_off"), "%50\\%\\_off%")
})

check("el mínimo de búsqueda es 2 caracteres", () => {
  assert.equal(NOTAS_BUSQUEDA_MIN, 2)
})

/* ----------------------------- serialización ------------------------------ */

check("notaDeRow mapea la fila cruda", () => {
  const created = new Date("2026-11-17T12:00:00Z")
  const updated = new Date("2026-11-17T13:30:00Z")
  const nota = notaDeRow({
    id: "b16f8e26-2f19-4a4e-9f68-5b48aa5ef6a1",
    title: "Título",
    body: "Texto",
    pinned: true,
    version: "3",
    created_at: created,
    updated_at: updated,
  })
  assert.equal(nota.id, "b16f8e26-2f19-4a4e-9f68-5b48aa5ef6a1")
  assert.equal(nota.title, "Título")
  assert.equal(nota.body, "Texto")
  assert.equal(nota.pinned, true)
  assert.equal(nota.version, 3)
  assert.equal(nota.createdAt, "2026-11-17T12:00:00.000Z")
  assert.equal(nota.updatedAt, "2026-11-17T13:30:00.000Z")
})

check("notaDeRow tolera valores ausentes", () => {
  const nota = notaDeRow({
    id: "b16f8e26-2f19-4a4e-9f68-5b48aa5ef6a1",
  })
  assert.equal(nota.title, "")
  assert.equal(nota.body, "")
  assert.equal(nota.pinned, false)
  assert.equal(nota.version, 1)
})

check("previewDeRow trunca el cuerpo y omite la versión", () => {
  const fila = {
    id: "b16f8e26-2f19-4a4e-9f68-5b48aa5ef6a1",
    title: "Título",
    body: "c".repeat(NOTA_PREVIEW_CHARS + 10),
    pinned: false,
    version: 9,
    updated_at: new Date("2026-11-17T13:30:00Z"),
  }
  const preview = previewDeRow(fila)
  assert.equal(preview.body.length, NOTA_PREVIEW_CHARS)
  assert.equal("version" in preview, false)
  assert.equal("createdAt" in preview, false)
  assert.equal(preview.updatedAt, "2026-11-17T13:30:00.000Z")
})

console.log(`\n${passed} pruebas OK`)
