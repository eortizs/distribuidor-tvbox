/**
 * Genera el badge Open Graph de SPEILink (la imagen de la vista previa del
 * link de pago en WhatsApp) a partir del original del dueno:
 * assets/badgeOG-spei-link.png (240x240) -> public/spei-link-og.png (480x480,
 * reescalado con lanczos).
 *
 * Meta pide imagenes de al menos 300 px de ancho para la vista previa de
 * WhatsApp; el original se queda corto, asi que se publica al doble para que
 * la tarjeta se vea nitida en pantallas de alta densidad.
 *
 *   node assets/generate-og-badge.mjs
 */
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

const SOURCE = path.join(here, "badgeOG-spei-link.png")
const TARGET = path.join(root, "public", "spei-link-og.png")
const SIZE = 480

const metadata = await sharp(SOURCE).metadata()
console.log(
  `origen: ${metadata.width}x${metadata.height} ${metadata.format} ${metadata.hasAlpha ? "con alfa" : "opaco"}`
)

// El original trae canal alfa: la tarjeta de WhatsApp se pinta sobre el
// fondo del tema (claro u oscuro), asi que el badge se aplana sobre blanco
// para que el logo nunca pierda contraste.
await mkdir(path.dirname(TARGET), { recursive: true })
await sharp(SOURCE)
  .resize(SIZE, SIZE, { fit: "inside", kernel: "lanczos3" })
  .flatten({ background: "#ffffff" })
  .png({ compressionLevel: 9 })
  .toFile(TARGET)

const result = await sharp(TARGET).metadata()
console.log(`public/spei-link-og.png: ${result.width}x${result.height} ${result.format}`)
