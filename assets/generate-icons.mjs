/**
 * Genera los iconos de la app a partir del artwork de la mascota.
 *
 *   node assets/generate-icons.mjs
 *
 * Salidas:
 *   src/app/icon.svg                      favicon (cuadrado, alterna con prefers-color-scheme)
 *   src/app/apple-icon.png                180x180 (iOS, cuadrado sin radio)
 *   public/icons/icon-192.png             192x192 (cualquier propósito)
 *   public/icons/icon-512.png             512x512 (cualquier propósito)
 *   public/icons/icon-maskable-512.png   512x512 (con máscara, zona segura)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

const CANVAS = 512
/** Radio del cuadro redondeado (mismo proportionado que el favicon anterior). */
const CORNER = 0.22 * CANVAS
/** Alto de la mascota dentro del icono. */
const MASCOT_HEIGHT = 440
/** Alto de la mascota en el icono con máscara: cabe dentro del círculo seguro (80%). */
const MASKABLE_HEIGHT = 300

const TILE = "#fcfcfb"
const INK = "#171717"

const source = await readFile(path.join(here, "mascota-tvbox.svg"), "utf8")

const paths = [
  ...source.matchAll(/<path[^>]*fill="([^"]+)"[^>]*d="([^"]*)"/g),
].map((match) => ({ fill: match[1], d: match[2] }))

if (paths.length !== 5) {
  throw new Error(
    `Se esperaban 5 paths en el artwork (fondo, cuerpo, pantalla y 2 ojos) y se encontraron ${paths.length}`
  )
}

const [, body, face, eyeLeft, eyeRight] = paths

/** Caja real de la mascota, sin el rectángulo de fondo del artwork. */
async function measureMascot() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1091 1441" width="1091" height="1441">
  <path fill="${INK}" d="${body.d}"/>
  <path fill="${TILE}" d="${face.d}"/>
  <path fill="${INK}" d="${eyeLeft.d}"/>
  <path fill="${INK}" d="${eyeRight.d}"/>
</svg>`

  const { info } = await sharp(Buffer.from(svg))
    .png()
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true })

  return {
    width: info.width,
    height: info.height,
    left: info.trimOffsetLeft ?? 0,
    top: info.trimOffsetTop ?? 0,
  }
}

/** Transformación que centra la mascota con el alto pedido dentro del lienzo. */
function layout(bbox, height) {
  const scale = height / bbox.height

  return {
    scale,
    width: bbox.width * scale,
    x: (CANVAS - bbox.width * scale) / 2 - bbox.left * scale,
    y: (CANVAS - height) / 2 - bbox.top * scale,
  }
}

/** SVG del favicon: la misma composición, con clases para poder invertir el tema. */
function iconSvg(box) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="TVBOX">
  <title>TVBOX</title>
  <style>
    .tile { fill: ${TILE}; }
    .body { fill: ${INK}; }
    .face { fill: ${TILE}; }
    .eye { fill: ${INK}; }
    @media (prefers-color-scheme: dark) {
      .tile { fill: ${INK}; }
      .body { fill: ${TILE}; }
      .face { fill: ${INK}; }
      .eye { fill: ${TILE}; }
    }
  </style>
  <rect class="tile" width="${CANVAS}" height="${CANVAS}" rx="${CORNER}"/>
  <g transform="translate(${box.x.toFixed(3)} ${box.y.toFixed(3)}) scale(${box.scale.toFixed(5)})">
    <path class="body" d="${body.d}"/>
    <path class="face" d="${face.d}"/>
    <path class="eye" d="${eyeLeft.d}"/>
    <path class="eye" d="${eyeRight.d}"/>
  </g>
</svg>
`
}

/** SVG plano (colores fijos) para rasterizar con sharp. */
function flatIconSvg(box, { radius, tile }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">
  <rect width="${CANVAS}" height="${CANVAS}"${radius ? ` rx="${radius}"` : ""} fill="${tile}"/>
  <g transform="translate(${box.x.toFixed(3)} ${box.y.toFixed(3)}) scale(${box.scale.toFixed(5)})">
    <path fill="${INK}" d="${body.d}"/>
    <path fill="${tile}" d="${face.d}"/>
    <path fill="${INK}" d="${eyeLeft.d}"/>
    <path fill="${INK}" d="${eyeRight.d}"/>
  </g>
</svg>
`
}

async function png(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file)
  console.log(`✓ ${path.relative(root, file)}`)
}

const bbox = await measureMascot()
const standard = layout(bbox, MASCOT_HEIGHT)
const maskable = layout(bbox, MASKABLE_HEIGHT)

await writeFile(path.join(root, "src/app/icon.svg"), iconSvg(standard))
console.log("✓ src/app/icon.svg")

await png(
  flatIconSvg(standard, { radius: 0, tile: TILE }),
  180,
  path.join(root, "src/app/apple-icon.png")
)

await mkdir(path.join(root, "public/icons"), { recursive: true })
await png(
  flatIconSvg(standard, { radius: CORNER, tile: TILE }),
  192,
  path.join(root, "public/icons/icon-192.png")
)
await png(
  flatIconSvg(standard, { radius: CORNER, tile: TILE }),
  512,
  path.join(root, "public/icons/icon-512.png")
)
await png(
  flatIconSvg(maskable, { radius: 0, tile: TILE }),
  512,
  path.join(root, "public/icons/icon-maskable-512.png")
)
