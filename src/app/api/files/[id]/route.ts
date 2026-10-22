import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import {
  deleteUserFile,
  getUserFile,
  isFileVariant,
  userFilePath,
  userFileVariantPath,
  type FileVariant,
  type UserFile,
} from "@/server/storage/user-files"
import {
  ensureFileVariant,
  variantFileName,
} from "@/server/storage/file-variants"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Sirve un binario del disco. Las variantes son inmutables (el contenido de
 * un archivo y su variante no cambian nunca), así que el navegador las
 * guarda; el original se sirve sin caché para no dejar copias en el disco
 * del cliente.
 */
function fileResponse(params: {
  filePath: string
  size: number
  mimeType: string
  fileName: string
  download: boolean
  immutable: boolean
}): Response {
  const { filePath, size, mimeType, fileName, download, immutable } = params
  const asciiName = fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
  const disposition = `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`

  const stream = Readable.toWeb(
    createReadStream(filePath)
  ) as ReadableStream<Uint8Array>

  return new Response(stream, {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(size),
      "Content-Disposition": disposition,
      "Cache-Control": immutable
        ? "private, max-age=31536000, immutable"
        : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

/**
 * Resuelve la variante pedida. Si el archivo todavía no la tiene, se deriva
 * del original en el momento (y se guarda para las siguientes peticiones).
 */
async function variantResponse(
  file: UserFile,
  variant: FileVariant,
  download: boolean
): Promise<Response> {
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
    throw new AppError(404, "not_found", "Esta versión de la imagen no está disponible")
  }
  return fileResponse({
    filePath,
    size,
    mimeType: record.mimeType,
    fileName: variantFileName(file.fileName, variant),
    download,
    immutable: true,
  })
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const file = await getUserFile(user.id, id)
    if (!file) throw new AppError(404, "not_found", "Archivo no encontrado")

    const { searchParams } = new URL(request.url)
    const download = searchParams.get("download") === "1"

    const variantParam = searchParams.get("variant")
    if (variantParam !== null && variantParam !== "") {
      if (!isFileVariant(variantParam)) {
        throw new AppError(
          422,
          "invalid_request",
          "La variante debe ser 'low' o 'thumb'"
        )
      }
      return await variantResponse(file, variantParam, download)
    }

    const filePath = userFilePath(file)
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      throw new AppError(404, "not_found", "Archivo no encontrado")
    }

    return fileResponse({
      filePath,
      size,
      mimeType: file.mimeType,
      fileName: file.fileName,
      download,
      immutable: false,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const deleted = await deleteUserFile(user.id, id)
    if (!deleted) throw new AppError(404, "not_found", "Archivo no encontrado")

    return Response.json({ ok: true, data: { id } })
  } catch (error) {
    return errorResponse(error)
  }
}
