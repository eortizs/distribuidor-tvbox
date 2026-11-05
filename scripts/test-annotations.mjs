/**
 * Pruebas de la lógica pura de «Dibujar» (src/server/images/annotations.ts):
 * validación del cuerpo, overlay SVG, nombre de la copia y mapa de formatos.
 * Corre con Node directo (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-annotations.mjs
 */
import assert from "node:assert/strict"
import sharp from "sharp"

import {
  MAX_ANNOTATION_STROKES,
  MAX_ANNOTATION_POINTS,
  MAX_STROKE_WIDTH_RATIO,
  MAX_ANNOTATION_FILE_NAME,
  annotationOutputMime,
  arrowGeometry,
  buildAnnotationOverlaySvg,
  copyFileName,
  extensionFor,
  sanitizeAnnotationInput,
} from "../src/server/images/annotations.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

const validStroke = {
  color: "#FF0000",
  width: 0.01,
  points: [
    [0, 0],
    [1, 1],
  ],
}

/* ---------------------------- sanitizeAnnotationInput -------------------- */

check("acepta un cuerpo válido y normaliza el color a minúsculas", () => {
  const result = sanitizeAnnotationInput({ strokes: [validStroke] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.strokes[0].color, "#ff0000")
    assert.equal(result.strokes[0].points.length, 2)
  }
})

check("rechaza cuerpos que no son objeto o sin strokes", () => {
  assert.equal(sanitizeAnnotationInput(null).ok, false)
  assert.equal(sanitizeAnnotationInput("x").ok, false)
  assert.equal(sanitizeAnnotationInput({}).ok, false)
  assert.equal(sanitizeAnnotationInput({ strokes: "x" }).ok, false)
})

check("rechaza lista de trazos vacía o por encima del límite", () => {
  assert.equal(sanitizeAnnotationInput({ strokes: [] }).ok, false)
  const tooMany = Array.from(
    { length: MAX_ANNOTATION_STROKES + 1 },
    () => validStroke
  )
  assert.equal(sanitizeAnnotationInput({ strokes: tooMany }).ok, false)
  const atLimit = Array.from({ length: MAX_ANNOTATION_STROKES }, () => validStroke)
  assert.equal(sanitizeAnnotationInput({ strokes: atLimit }).ok, true)
})

check("rechaza colores no HEX opacos", () => {
  for (const color of ["red", "#fff", "#ffff", "#00000000", "#11223344", "rgb(1,2,3)", "", "#GGHHII"]) {
    assert.equal(
      sanitizeAnnotationInput({ strokes: [{ ...validStroke, color }] }).ok,
      false,
      color
    )
  }
})

check("rechaza coordenadas no finitas o fuera de rango", () => {
  const cases = [
    [[NaN, 0]],
    [[0, Infinity]],
    [[-0.001, 0]],
    [[0, 1.0000001]],
    [["0.5", 0]],
    [[0, 0, 0]],
    [0],
    [[0]],
  ]
  for (const points of cases) {
    assert.equal(
      sanitizeAnnotationInput({ strokes: [{ ...validStroke, points }] }).ok,
      false,
      JSON.stringify(points)
    )
  }
})

check("rechaza grosores inválidos", () => {
  for (const width of [0, -0.01, MAX_STROKE_WIDTH_RATIO + 0.001, Number.NaN, "0.01"]) {
    assert.equal(
      sanitizeAnnotationInput({ strokes: [{ ...validStroke, width }] }).ok,
      false,
      String(width)
    )
  }
  assert.equal(
    sanitizeAnnotationInput({ strokes: [{ ...validStroke, width: MAX_STROKE_WIDTH_RATIO }] })
      .ok,
    true
  )
})

check("rechaza trazos sin puntos y puntos mal formados", () => {
  assert.equal(sanitizeAnnotationInput({ strokes: [{ color: "#ff0000", width: 0.01, points: [] }] }).ok, false)
  assert.equal(sanitizeAnnotationInput({ strokes: [null] }).ok, false)
  assert.equal(sanitizeAnnotationInput({ strokes: [{ color: "#ff0000", width: 0.01 }] }).ok, false)
})

check("rechaza por encima del límite total de puntos", () => {
  const stroke = {
    color: "#ff0000",
    width: 0.01,
    points: Array.from({ length: MAX_ANNOTATION_POINTS + 1 }, () => [0.5, 0.5]),
  }
  assert.equal(sanitizeAnnotationInput({ strokes: [stroke] }).ok, false)
  const strokeB = {
    color: "#ff0000",
    width: 0.01,
    points: Array.from({ length: MAX_ANNOTATION_POINTS - 1 }, () => [0.5, 0.5]),
  }
  // MAX+1 puntos en dos trazos también exceden.
  assert.equal(
    sanitizeAnnotationInput({ strokes: [strokeB, { ...validStroke, points: [[0, 0], [1, 1]] }] }).ok,
    false
  )
})

/* ---------------------------- buildAnnotationOverlaySvg ------------------ */

/** Mismo orden que el endpoint: valida primero y compone con la salida. */
function parseStrokes(strokes) {
  const result = sanitizeAnnotationInput({ strokes })
  assert.equal(result.ok, true, "strokes de prueba deben ser válidos")
  return result.ok ? result.strokes : []
}

check("el SVG usa las dimensiones dadas y trazos redondeados", () => {
  const svg = buildAnnotationOverlaySvg(800, 600, parseStrokes([validStroke]))
  assert.match(svg, /width="800"/)
  assert.match(svg, /height="600"/)
  assert.match(svg, /stroke="#ff0000"/)
  assert.match(svg, /stroke-linecap="round"/)
  assert.match(svg, /stroke-linejoin="round"/)
  assert.match(svg, /fill="none"/)
  assert.match(svg, /M0\.000 0\.000/)
  assert.match(svg, /L800\.000 600\.000/)
  assert.match(svg, /stroke-width="8\.000"/)
})

check("un toque se dibuja como punto (círculo del diámetro del trazo)", () => {
  const svg = buildAnnotationOverlaySvg(800, 600, parseStrokes([
    { color: "#000000", width: 0.01, points: [[0.25, 0.5]] },
  ]))
  assert.match(svg, /<circle cx="200\.000" cy="300\.000" r="4\.000" fill="#000000"\/>/)
})

check("grosor mínimo de 1 px en imágenes pequeñas", () => {
  const svg = buildAnnotationOverlaySvg(20, 10, parseStrokes([
    { color: "#ffffff", width: 0.001, points: [[0, 0], [1, 1]] },
  ]))
  assert.match(svg, /stroke-width="1\.000"/)
})

check("el overlay es un SVG exacto (solo números y colores validados)", () => {
  const svg = buildAnnotationOverlaySvg(100, 100, parseStrokes([
    { color: "#123456", width: 0.02, points: [[0.1, 0.9], [0.9, 0.1]] },
  ]))
  assert.equal(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
      '<path d="M10.000 90.000L90.000 10.000" fill="none" stroke="#123456" stroke-width="2.000" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>'
  )
})

/* ---------------------------- flechas ------------------------------------ */

const validArrow = {
  kind: "arrow",
  color: "#ff0000",
  width: 0.01,
  points: [[0.1, 0.5], [0.9, 0.5]], // punta primero, cola después
}

check("acepta una flecha con sus dos puntos exactos", () => {
  const result = sanitizeAnnotationInput({ strokes: [validArrow] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.strokes[0].kind, "arrow")
    assert.equal(result.strokes[0].points.length, 2)
  }
})

check("sin kind explícito el trazo es lápiz (compatibilidad)", () => {
  const result = sanitizeAnnotationInput({ strokes: [validStroke] })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.strokes[0].kind, "path")
})

check("rechaza flechas sin dos puntos exactos y kind inválido", () => {
  assert.equal(
    sanitizeAnnotationInput({ strokes: [{ ...validArrow, points: [[0.1, 0.5]] }] }).ok,
    false
  )
  assert.equal(
    sanitizeAnnotationInput({
      strokes: [{ ...validArrow, points: [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]] }],
    }).ok,
    false
  )
  assert.equal(
    sanitizeAnnotationInput({ strokes: [{ ...validArrow, kind: "línea" }] }).ok,
    false
  )
})

check("el SVG de una flecha lleva línea y punta triangular, sin chips", () => {
  const svg = buildAnnotationOverlaySvg(800, 400, parseStrokes([validArrow]))
  assert.match(svg, /<line x1="720\.000" y1="200\.000" x2="80\.000" y2="200\.000"/)
  assert.match(
    svg,
    /<polygon points="80\.000,200\.000 104\.000,185\.600 104\.000,214\.400" fill="#ff0000"\/>/
  )
  assert.ok(!svg.includes("<text"), "sin texto de chips")
  assert.ok(!svg.includes("<circle"), "sin badge de chip")
})

check("cada flecha se imprime como línea y punta del color elegido", () => {
  const svg = buildAnnotationOverlaySvg(800, 400, parseStrokes([
    validArrow,
    { ...validArrow, color: "#0000ff", points: [[0.2, 0.2], [0.8, 0.2]] },
  ]))
  assert.match(svg, /stroke="#ff0000"/)
  assert.match(svg, /stroke="#0000ff"/)
  assert.equal(svg.split("<polygon").length - 1, 2)
  assert.ok(!svg.includes("<text"))
})

check("arrowGeometry: dirección, tamaños y flecha degenerada segura", () => {
  const g = arrowGeometry(
    { x: 0.9, y: 0.5 },
    { x: 0.1, y: 0.5 },
    8,
    800,
    400
  )
  assert.equal(g.dirX, -1)
  assert.equal(g.dirY, 0)
  assert.equal(g.tipX, 80)
  assert.equal(g.tailX, 720)
  assert.equal(g.headLen, 24)
  assert.equal(g.headHalf, 14.4)
  // Flecha degenerada (misma punta y cola): dirección segura hacia arriba.
  const degenerate = arrowGeometry(
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    8,
    800,
    400
  )
  assert.equal(degenerate.dirX, 0)
  assert.equal(degenerate.dirY, -1)
})

/* ---------------------------- copyFileName ------------------------------- */

check("nombre de copia con sufijo y extensión", () => {
  assert.equal(copyFileName("foto.jpg", "jpg"), "foto (copia).jpg")
  assert.equal(copyFileName("sin-extension", "png"), "sin-extension (copia).png")
  assert.equal(copyFileName("origen.webp", "png"), "origen (copia).png")
})

check("nombres raros caen a la base por omisión", () => {
  assert.equal(copyFileName(".jpg", "png"), "imagen (copia).png")
  assert.equal(copyFileName("", "webp"), "imagen (copia).webp")
  assert.equal(copyFileName("   ", "png"), "imagen (copia).png")
})

check("conserva paréntesis y Unicode", () => {
  assert.equal(
    copyFileName("receta (1) de mamá", "png"),
    "receta (1) de mamá (copia).png"
  )
})

check("los fragmentos con rutas los recorta después sanitizeFileName", () => {
  // copyFileName no ve rutas: el que corta separadores es sanitizeFileName
  // (split por / y \), que sigue aplicándose al guardar.
  assert.equal(
    copyFileName("../../etc/passwd.png", "png"),
    "../../etc/passwd (copia).png"
  )
})

check("nombres largos conservan sufijo y extensión dentro del límite", () => {
  const longName = `${"m".repeat(300)}.jpg`
  const name = copyFileName(longName, "jpg")
  assert.ok(name.length <= MAX_ANNOTATION_FILE_NAME, `length ${name.length}`)
  assert.ok(name.endsWith(" (copia).jpg"))
})

check("extensión pedida fuera de rango se sanea", () => {
  const name = copyFileName("foto", ".png")
  assert.equal(name, "foto (copia).png")
})

/* ---------------------------- formatos ----------------------------------- */

check("mapa de formatos de salida", () => {
  assert.equal(annotationOutputMime("image/jpeg"), "image/jpeg")
  assert.equal(annotationOutputMime("image/webp"), "image/webp")
  assert.equal(annotationOutputMime("image/png"), "image/png")
  assert.equal(annotationOutputMime("image/gif"), "image/png")
  assert.equal(annotationOutputMime("image/avif"), "image/png")
  assert.equal(annotationOutputMime("application/octet-stream"), "image/png")
  assert.equal(extensionFor("image/jpeg"), "jpg")
  assert.equal(extensionFor("image/webp"), "webp")
  assert.equal(extensionFor("image/png"), "png")
})

/* ---------------------------- composición con Sharp ---------------------- */

check("Sharp compone el overlay a la resolución del original", async () => {
  const base = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer()
  const overlay = Buffer.from(
    buildAnnotationOverlaySvg(64, 48, parseStrokes([
      { color: "#ff0000", width: 0.05, points: [[0, 0.5], [1, 0.5]] },
    ]))
  )
  const { data, info } = await sharp(base)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 64)
  assert.equal(info.height, 48)
  // El centro de la línea debe ser rojo puro (el fondo era blanco). La
  // salida PNG es RGBA: el índice depende de los canales reales.
  const raw = await sharp(data).raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => {
    const start = (y * raw.info.width + x) * raw.info.channels
    return [raw.data[start], raw.data[start + 1], raw.data[start + 2]]
  }
  assert.deepEqual(at(4, 24), [255, 0, 0])
  assert.deepEqual(at(60, 24), [255, 0, 0])
  // Fuera del trazo sigue blanco.
  assert.deepEqual(at(4, 4), [255, 255, 255])
})

console.log(`\n${passed} pruebas OK`)
