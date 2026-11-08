import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { ensureFileVariant, variantFileName } from "@/server/storage/file-variants"
import {
  getUserFile,
  isFileVariant,
  userFilePath,
  userFileVariantPath,
  type FileVariant,
} from "@/server/storage/user-files"
import { obtenerVista } from "@/server/tickets/service"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Foto del ticket, solo para su propietario: la pertenencia se resuelve por
 * el registro del ticket (no por el archivo), así que el dueño de un ticket
 * siempre puede ver SU foto aunque los adjuntos envejezcan. `private,
 * no-store`: nada de estas fotos termina en cachés compartidos. Variante
 * opcional ?variant=thumb|low para el historial.
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    if (!UUID_RE.test(id)) {
      throw new AppError(404, "not_found", "Ticket no encontrado")
    }
    const vista = await obtenerVista(user.id, id)
    if (!vista) throw new AppError(404, "not_found", "Ticket no encontrado")

    const file = await getUserFile(user.id, vista.fileId)
    if (!file) throw new AppError(404, "not_found", "La foto no está disponible")

    const { searchParams } = new URL(request.url)
    const variantParam = searchParams.get("variant")
    if (variantParam !== null && variantParam !== "") {
      if (!isFileVariant(variantParam)) {
        throw new AppError(
          422,
          "invalid_request",
          "La variante debe ser 'low' o 'thumb'"
        )
      }
      const variant = variantParam as FileVariant
      const record = await ensureFileVariant(file, variant)
      if (!record) {
        throw new AppError(
          404,
          "not_found",
          "Esta versión de la imagen no está disponible"
        )
      }
      const filePath = userFileVariantPath(file, variant)
      let size: number
      try {
        size = (await stat(filePath)).size
      } catch {
        throw new AppError(
          404,
          "not_found",
          "Esta versión de la imagen no está disponible"
        )
      }
      return streamResponse({
        filePath,
        size,
        mimeType: record.mimeType,
        fileName: variantFileName(file.fileName, variant),
      })
    }

    const filePath = userFilePath(file)
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      throw new AppError(404, "not_found", "La foto no está disponible")
    }
    return streamResponse({
      filePath,
      size,
      mimeType: file.mimeType,
      fileName: file.fileName,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

function streamResponse(params: {
  filePath: string
  size: number
  mimeType: string
  fileName: string
}): Response {
  const asciiName = params.fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
  const stream = Readable.toWeb(
    createReadStream(params.filePath)
  ) as ReadableStream<Uint8Array>
  return new Response(stream, {
    headers: {
      "Content-Type": params.mimeType,
      "Content-Length": String(params.size),
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(params.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
