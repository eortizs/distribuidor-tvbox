#!/usr/bin/env node
/**
 * Pruebas de src/lib/tenant-slug.ts (Fase 1 §4.1): slugify, forma y
 * reservados públicos. Corre con Node directo (Node 24 elimina tipos al
 * importar .ts):
 *
 *   node scripts/test-tenant-slug.mjs
 */
import { strict as assert } from "node:assert"

import {
  slugify,
  slugAvailabilityShape,
  PUBLIC_RESERVED_SLUGS,
} from "../src/lib/tenant-slug.ts"

let passed = 0
function ok(name, fn) {
  try {
    fn()
    passed++
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`)
    process.exitCode = 1
  }
}

// slugify: formas básicas
ok("slugify simple", () =>
  assert.equal(slugify("Abarrotes Doña Lupe"), "abarrotes-dona-lupe"))
ok("slugify acentos", () => assert.equal(slugify("Café Ñandú"), "cafe-nandu"))
ok("slugify colapsa guiones", () =>
  assert.equal(slugify("Mi  --  Negocio"), "mi-negocio"))
ok("slugify recorta extremos", () => assert.equal(slugify("--Tienda--"), "tienda"))
ok("slugify mayúsculas y símbolos", () =>
  assert.equal(slugify("Bodega «La Central» S.A."), "bodega-la-central-s-a"))
ok("slugify vacío", () => assert.equal(slugify("   "), ""))
ok("slugify solo símbolos", () => assert.equal(slugify("!!! ???"), ""))
ok("slugify tope 30", () => {
  const s = slugify("un nombre de negocio verdaderamente muy largo para un slug")
  assert.ok(s.length <= 30, `length=${s.length}`)
  assert.ok(!s.endsWith("-"), "no termina en guion tras recortar")
})

// Forma
ok("forma válida", () => {
  assert.deepEqual(slugAvailabilityShape("donpolo"), { available: true })
  assert.deepEqual(slugAvailabilityShape("mi-tienda-2"), { available: true })
})
ok("forma inválida: vacío", () =>
  assert.deepEqual(slugAvailabilityShape(""), { available: false, reason: "forma" }))
ok("forma inválida: guion extremo", () =>
  assert.deepEqual(slugAvailabilityShape("-tienda"), { available: false, reason: "forma" }))
ok("forma inválida: muy corto", () =>
  assert.deepEqual(slugAvailabilityShape("ab"), { available: false, reason: "forma" }))
ok("forma inválida: caracteres", () =>
  assert.deepEqual(slugAvailabilityShape("mi_tienda"), { available: false, reason: "forma" }))
ok("forma inválida: muy largo", () =>
  assert.deepEqual(slugAvailabilityShape("a".repeat(31)), { available: false, reason: "forma" }))
ok("normaliza mayúsculas", () => {
  // La regla del catálogo es minúsculas: el servidor normaliza antes.
  assert.deepEqual(slugAvailabilityShape("DONPOLO".toLowerCase()), { available: true })
})

// Reservados públicos
ok("reservados de marca", () => {
  for (const slug of ["spei", "speilink", "spei-link"]) {
    assert.deepEqual(slugAvailabilityShape(slug), { available: false, reason: "reservado" }, slug)
  }
})
ok("reservados de soporte", () => {
  for (const slug of ["soporte", "ayuda", "support"]) {
    assert.deepEqual(slugAvailabilityShape(slug), { available: false, reason: "reservado" }, slug)
  }
})
ok("reservados de impersonación", () => {
  for (const slug of ["admin", "administrador", "plataforma", "banxico"]) {
    assert.deepEqual(slugAvailabilityShape(slug), { available: false, reason: "reservado" }, slug)
  }
})
ok("reservados de marca de terceros", () => {
  for (const slug of ["whatsapp", "mercado", "mercadopago", "mercado-pago"]) {
    assert.deepEqual(slugAvailabilityShape(slug), { available: false, reason: "reservado" }, slug)
  }
})
ok("el catálogo reservado de hosts no filtra aquí (consola no cambia)", () => {
  // 'www'/'app'/'api' son reservados de INFRA (hosts.ts) y siguen permitidos
  // en el catálogo vía consola; el registro público solo añade los suyos.
  assert.ok(!PUBLIC_RESERVED_SLUGS.has("www"))
})

if (process.exitCode) {
  console.error(`\n${passed} pruebas OK, con fallos`)
} else {
  console.log(`${passed} pruebas OK`)
}
