/**
 * Compartir una imagen desde el navegador.
 *
 * Las imágenes de la galería viven detrás de la sesión del usuario, así que
 * no hay una URL pública que repartir: lo que se comparte es el archivo (la
 * versión baja, que pesa poco) con la Web Share API y, cuando el navegador no
 * sabe compartir archivos, la imagen copiada al portapapeles.
 */

const PNG_TYPE = "image/png"

/** Cómo terminó un intento de compartir. */
export type ShareOutcome = "shared" | "copied" | "cancelled"

/** Lo que se puede compartir de una imagen. */
export type ShareTarget = {
  /** El archivo tal como lo entrega el servidor (WebP de la versión baja). */
  file: File
  /** La misma imagen en PNG: el portapapeles solo acepta PNG. */
  png: Blob | null
}

/** ¿El navegador tiene hoja de compartir (WhatsApp, Telegram, la del sistema)? */
export function hasShareSheet(): boolean {
  if (typeof navigator === "undefined") return false
  return typeof navigator.share === "function"
}

/** ¿El navegador sabe compartir estos archivos? */
export function canShareFiles(files: File[]): boolean {
  if (!hasShareSheet()) return false
  if (typeof navigator.canShare !== "function") return true
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/** Convierte una imagen a PNG (el único formato que acepta el portapapeles). */
export async function imageToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("no-2d-context")
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error("png-failed"))
      }, PNG_TYPE)
    })
  } finally {
    bitmap.close()
  }
}

/** Copia la imagen al portapapeles del sistema. */
export async function copyImageToClipboard(file: File): Promise<void> {
  if (typeof navigator === "undefined") throw new Error("clipboard-unavailable")
  if (typeof navigator.clipboard?.write !== "function") {
    throw new Error("clipboard-unavailable")
  }
  if (typeof ClipboardItem === "undefined") {
    throw new Error("clipboard-unavailable")
  }
  await navigator.clipboard.write([
    // El ClipboardItem se crea aquí, dentro del gesto del usuario: Safari
    // rechaza la escritura si el elemento se construye más tarde.
    new ClipboardItem({ [PNG_TYPE]: imageToPng(file) }),
  ])
}

/** El usuario cerró la hoja de compartir sin elegir nada. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

/** Nombre del archivo cuando la imagen va en PNG. */
function pngName(name: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.png`
}

/**
 * Comparte la imagen: primero con la Web Share API (WhatsApp, Telegram, la
 * hoja del sistema…) y, si el navegador no puede compartir archivos, copiándola
 * al portapapeles para pegarla donde el usuario quiera.
 */
export async function shareImage(target: ShareTarget): Promise<ShareOutcome> {
  const candidates: File[] = []
  if (canShareFiles([target.file])) candidates.push(target.file)
  if (target.png) {
    const pngFile = new File([target.png], pngName(target.file.name), {
      type: PNG_TYPE,
    })
    if (canShareFiles([pngFile])) candidates.push(pngFile)
  }

  if (candidates.length > 0) {
    try {
      await navigator.share({ files: [candidates[0]] })
      return "shared"
    } catch (error) {
      // El usuario cerró la hoja de compartir: no es un fallo.
      if (isAbort(error)) return "cancelled"
    }
  }

  await copyImageToClipboard(target.file)
  return "copied"
}
