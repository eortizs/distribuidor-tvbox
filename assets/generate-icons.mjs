/**
 * Genera los iconos de la app a partir del isotipo SPEILink
 * (assets/SPEILink-logo-S.svg): la «S» azul sobre el azulejo claro.
 *
 *   node assets/generate-icons.mjs
 *
 * Salidas:
 *   src/app/favicon.ico                   16/32/48 (ICO con entradas PNG)
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
/** Radio del cuadro redondeado (misma proporción que el icono anterior). */
const CORNER = 0.22 * CANVAS
/** Alto de la «S» dentro del icono estándar. */
const MARK_HEIGHT = 440
/** Alto de la «S» en el icono con máscara: cabe dentro del círculo seguro (80%). */
const MASKABLE_HEIGHT = 300
/** Tamaños de las entradas del favicon.ico. */
const FAVICON_SIZES = [16, 32, 48]

const TILE = "#fcfcfb"
const SOURCE_FILE = "SPEILink-logo-S.svg"

const source = await readFile(path.join(here, SOURCE_FILE), "utf8")

/**
 * Marca recortada: se rasteriza el SVG y se recorta el margen. El centrado
 * después es puramente geométrico sobre el raster (sin depender de la
 * convención de signos de trimOffset* de sharp).
 */
async function trimmedMark() {
  const { data, info } = await sharp(Buffer.from(source))
    .png()
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true })

  if (!info.width || !info.height) {
    throw new Error(`El recorte de ${SOURCE_FILE} quedó vacío`)
  }

  return { data, width: info.width, height: info.height }
}

/** Raster de la marca escalado al alto pedido. */
async function markAtHeight(mark, height) {
  const scale = height / mark.height
  return sharp(mark.data)
    .resize(Math.round(mark.width * scale), Math.round(height))
    .png()
    .toBuffer()
}

/** Azulejo con la marca centrada; devuelve el PNG de 512 listo para usar. */
async function composeIcon(mark, { height, radius }) {
  const resized = await markAtHeight(mark, height)
  const left = Math.round((CANVAS - (mark.width * height) / mark.height) / 2)
  const top = Math.round((CANVAS - height) / 2)
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}"><rect width="${CANVAS}" height="${CANVAS}"${radius ? ` rx="${radius}"` : ""} fill="${TILE}"/></svg>`

  return sharp(Buffer.from(tile))
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer()
}

async function writePng(icon, size, file) {
  await sharp(icon).resize(size, size).png({ compressionLevel: 9 }).toFile(file)
  console.log(`✓ ${path.relative(root, file)}`)
}

/** ICO con entradas PNG (formato válido desde Windows Vista y en todos los navegadores). */
async function writeIco(icon, sizes, file) {
  const entries = []
  for (const size of sizes) {
    const data = await sharp(icon)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer()
    entries.push({ size, data })
  }

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // tipo icono
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach((entry, i) => {
    const at = i * 16
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at) // ancho (0 = 256)
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    dir.writeUInt8(0, at + 2) // paleta
    dir.writeUInt8(0, at + 3) // reservado
    dir.writeUInt16LE(1, at + 4) // planos
    dir.writeUInt16LE(32, at + 6) // bits por pixel
    dir.writeUInt32LE(entry.data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += entry.data.length
  })

  await writeFile(
    file,
    Buffer.concat([header, dir, ...entries.map((entry) => entry.data)])
  )
  console.log(`✓ ${path.relative(root, file)}`)
}

const mark = await trimmedMark()
const standard = await composeIcon(mark, { height: MARK_HEIGHT, radius: 0 })
const rounded = await composeIcon(mark, { height: MARK_HEIGHT, radius: CORNER })
const maskable = await composeIcon(mark, { height: MASKABLE_HEIGHT, radius: 0 })

await writeIco(standard, FAVICON_SIZES, path.join(root, "src/app/favicon.ico"))

await writePng(standard, 180, path.join(root, "src/app/apple-icon.png"))

await mkdir(path.join(root, "public/icons"), { recursive: true })
await writePng(rounded, 192, path.join(root, "public/icons/icon-192.png"))
await writePng(rounded, 512, path.join(root, "public/icons/icon-512.png"))
await writePng(maskable, 512, path.join(root, "public/icons/icon-maskable-512.png"))
