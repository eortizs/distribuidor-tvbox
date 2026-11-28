import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import sharp from "sharp"

import { capturarImagenConChrome, resolverChromeBin } from "./chrome-print"
import { renderTicketHtml, TICKET_ALTO_PX, TICKET_ANCHO_PX, type TicketCompraDatos } from "./ticket-html"

/*
 * Captura del ticket de compra como IMAGEN WEBP con el Chrome headless que
 * ya vive en el VPS (caché de navegadores de Playwright), vía protocolo
 * DevTools con marco de tamaño EXACTO y escala 2x — WhatsApp muestra la
 * imagen con el branding de inmediato (un PDF solo muestra un icono). La
 * captura sale PNG de Chrome y se comprime a WEBP con sharp (calidad 75:
 * ~50 KB vs ~150 KB del PNG — carga ligera en datos móviles manteniendo el
 * texto nítido). Sin dependencias nuevas. El fallo es DATO (el llamador
 * degrada al mensaje de texto de siempre — el pagador nunca se queda sin
 * aviso).
 *
 * La imagen queda en `storage/tickets/` (gitignored) porque la fila de
 * `wa_outbox` la referencia por ruta: el dispatcher puede reenviarla en los
 * reintentos aunque el proceso se haya reiniciado. `podarTicketsViejos`
 * limpia las antiguas en el mantenimiento horario de la cola.
 */

const TICKETS_DIR = path.join(process.cwd(), "storage", "tickets")
/** Un PNG válido del ticket pesa >5 KB (fuentes + gradientes); menos = fallo. */
const IMAGEN_MIN_BYTES = 2_000
/** Calidad WebP de entrega: el punto donde el texto sigue nítido y el
 * archivo queda en ~50 KB (probado sobre captura real 840×2160). */
const TICKET_WEBP_CALIDAD = 75
const RETENCION_TICKETS_DIAS = 14

export interface TicketImagenGenerado {
  filePath: string
  fileName: string
  mime: "image/webp"
}

/**
 * Genera la imagen del ticket con los datos dados y la deja en
 * `storage/tickets/<base>.webp`. Lanza si no hay Chrome o la captura falla:
 * el llamador decide el fallback.
 */
export async function generarTicketImagen(
  datos: TicketCompraDatos,
  nombreBase: string
): Promise<TicketImagenGenerado> {
  const bin = resolverChromeBin()
  if (!bin) throw new Error("ticket_chrome_no_encontrado")
  const seguro = nombreBase.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80)
  if (!seguro) throw new Error("ticket_nombre_invalido")

  await mkdir(TICKETS_DIR, { recursive: true })
  const imagenPath = path.join(TICKETS_DIR, `${seguro}.webp`)
  const htmlPath = path.join(TICKETS_DIR, `${seguro}-${randomUUID()}.html`)
  await writeFile(htmlPath, renderTicketHtml(datos), "utf8")
  try {
    const png = await capturarImagenConChrome({
      bin,
      htmlPath,
      anchoPx: TICKET_ANCHO_PX,
      altoPx: TICKET_ALTO_PX,
    })
    if (png.length < IMAGEN_MIN_BYTES) {
      throw new Error("ticket_imagen_vacia")
    }
    const webp = await sharp(png)
      .webp({ quality: TICKET_WEBP_CALIDAD, effort: 4, smartSubsample: true })
      .toBuffer()
    if (webp.length < IMAGEN_MIN_BYTES) {
      throw new Error("ticket_imagen_vacia")
    }
    await writeFile(imagenPath, webp)
    return { filePath: imagenPath, fileName: `${seguro}.webp`, mime: "image/webp" }
  } finally {
    await rm(htmlPath, { force: true }).catch(() => {})
  }
}

/** Poda las imágenes entregadas o abandonadas (mantenimiento horario de la cola). */
export async function podarTicketsViejos(): Promise<void> {
  const nombres = await readdir(TICKETS_DIR).catch(() => [])
  if (nombres.length === 0) return
  const limite = Date.now() - RETENCION_TICKETS_DIAS * 24 * 60 * 60 * 1000
  for (const nombre of nombres) {
    const completo = path.join(TICKETS_DIR, nombre)
    const info = await stat(completo).catch(() => null)
    if (info && info.mtimeMs < limite) {
      await rm(completo, { force: true }).catch(() => {})
    }
  }
}
