/**
 * Pruebas del TICKET DE COMPRA como IMAGEN (src/server/tickets/):
 *
 * 1. Plantilla HTML pura (ticket-html.ts): inyección de datos con escape,
 *    secciones del diseño, marco de tamaño exacto y logo incrustado.
 * 2. Captura FIEL con el núcleo REAL (`chrome-print.ts`: resolución del
 *    binario del VPS + captura vía protocolo DevTools con clip exacto y
 *    escala 2x) y compresión WEBP de entrega (ticket-imagen.ts, sharp q75):
 *    WebP válido de 840×2160 (420×1080 @2x) en POCOS KB con contenido real.
 *
 * Corre con Node directo (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-ticket-imagen.mjs
 *
 * Sin Chrome headless disponible las pruebas de imagen se marcan SKIP y la
 * suite pasa (la generación es feature opcional con fallback a texto).
 */
import assert from "node:assert/strict"
import { register } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"

import sharp from "sharp"

import { resolverChromeBin } from "../src/server/tickets/chrome-print.ts"
import {
  renderTicketHtml,
  TICKET_ALTO_PX,
  TICKET_ANCHO_PX,
} from "../src/server/tickets/ticket-html.ts"

// El hook resuelve los imports internos SIN extensión de los módulos TS
// (patrón del repo, p. ej. "./chrome-print" dentro de ticket-imagen.ts).
// Debe registrarse ANTES del import dinámico de abajo.
register("./lib/ts-resolver.mjs", new URL(".", import.meta.url).href)
const { generarTicketImagen } = await import("../src/server/tickets/ticket-imagen.ts")

const tmp = await mkdtemp("/tmp/kilo/ticket-test-")
let passed = 0
const skips = []

function check(name, run) {
  run()
  passed += 1
}

const DATOS = {
  titulo: "Ticket de compra",
  subtitulo: "Gracias por seguir con nosotros",
  fecha: "28 de noviembre de 2026",
  hora: "10:14",
  folio: "849201",
  cliente: "Carlos Mendoza",
  concepto: "Plan 1 mes",
  metodoPago: "Transferencia",
  estado: "Pagado",
  total: "100.00",
  moneda: "MXN",
  etiquetaTotal: "Total",
  tagline: "miscelanea don polo",
  gracias: "¡Gracias por tu compra!",
  equipo: "SPEILink",
}

// ── 1. Plantilla HTML ──────────────────────────────────────────────────────

const html = renderTicketHtml(DATOS)

check("la plantilla inyecta todos los datos", () => {
  for (const texto of [
    DATOS.titulo,
    DATOS.folio,
    DATOS.cliente,
    DATOS.concepto,
    DATOS.metodoPago,
    DATOS.estado,
    `$${DATOS.total} ${DATOS.moneda}`,
    DATOS.fecha,
    DATOS.hora,
    DATOS.tagline,
    DATOS.gracias,
    DATOS.equipo,
  ]) {
    assert.ok(html.includes(texto), `falta: ${texto}`)
  }
})

check("los valores se HTML-escapean", () => {
  const escapado = renderTicketHtml({
    ...DATOS,
    cliente: 'Ana <"Pérez">',
  })
  assert.ok(escapado.includes("Ana &lt;&quot;Pérez&quot;&gt;"))
  assert.ok(!escapado.includes('Ana <"Pérez">'))
})

check("marco HTML del tamaño exacto del ticket", () => {
  assert.ok(
    html.includes(
      `@page { size: ${TICKET_ANCHO_PX}px ${TICKET_ALTO_PX}px; margin: 0 }`
    )
  )
  assert.ok(html.includes(`width:${TICKET_ANCHO_PX}px`))
  assert.ok(html.includes(`height:${TICKET_ALTO_PX - 32}px`))
})

check("logo Flujo incrustado (SVG inline, no por referencia)", () => {
  assert.ok(html.includes("<svg") && html.includes("Gradient1"))
  assert.ok(!html.includes('src="'))
})

check("sin JavaScript en la plantilla de servidor", () => {
  assert.ok(!html.includes("<script"))
})

// ── 2. Captura WebP (núcleo real, como produce el ticket) ─────────────────

const chrome = resolverChromeBin()
let webpBuffer = null

if (!chrome) {
  skips.push("imagen (sin Chrome headless disponible)")
} else {
  // A través de generarTicketImagen: la MISMA pieza que usa producción
  // (captura + compresión WebP + archivo en storage/tickets/).
  const generado = await generarTicketImagen(
    { ...DATOS, folio: "ZZTEST" },
    "ticket-ZZTEST"
  )
  const { readFile } = await import("node:fs/promises")
  webpBuffer = await readFile(generado.filePath)
  await rm(generado.filePath, { force: true })

  check("el archivo se genera como WebP válido", () => {
    assert.equal(generado.mime, "image/webp")
    assert.ok(generado.fileName.endsWith(".webp"))
    // Firma RIFF....WEBP
    assert.equal(webpBuffer.subarray(0, 4).toString("latin1"), "RIFF")
    assert.equal(webpBuffer.subarray(8, 12).toString("latin1"), "WEBP")
    assert.ok(webpBuffer.length > 2_000, `peso sospechoso: ${webpBuffer.length}`)
  })

  check("dimensiones 420×1080 @2x = 840×2160", async () => {
    const meta = await sharp(webpBuffer).metadata()
    assert.equal(meta.format, "webp")
    assert.equal(meta.width, TICKET_ANCHO_PX * 2)
    assert.equal(meta.height, TICKET_ALTO_PX * 2)
  })

  check("la imagen está COMPRIMIDA en POCOS KB (<120 KB)", () => {
    // El PNG crudo de la misma captura pesa ~150 KB; el WebP de entrega debe
    // quedar muy por debajo conservando el contenido.
    assert.ok(webpBuffer.length < 120_000, `peso: ${webpBuffer.length}`)
  })

  check("la captura trae contenido real (fuentes y gradientes)", () => {
    // Una captura en blanco vacía queda muy por debajo de este piso.
    assert.ok(webpBuffer.length > 10_000, `peso: ${webpBuffer.length}`)
  })

  // Datos con caracteres HTML: el escape sigue aplicando en el flujo real.
  const escapado = await generarTicketImagen(
    { ...DATOS, folio: "ZZTST2", cliente: 'Ana <"Pérez">' },
    "ticket-ZZTST2"
  )
  await rm(escapado.filePath, { force: true })
  check("el flujo real genera sin lanzar con datos con caracteres HTML", () => {
    assert.ok(escapado.filePath.endsWith(".webp"))
  })
}

await rm(tmp, { recursive: true, force: true })
console.log(`ticket-imagen: ${passed} pruebas OK${skips.length ? ` (omitidas: ${skips.join(", ")})` : ""}`)
if (webpBuffer) console.log(`  WebP de muestra: ${webpBuffer.length} bytes (${Math.round(webpBuffer.length / 1024)} KB)`)
