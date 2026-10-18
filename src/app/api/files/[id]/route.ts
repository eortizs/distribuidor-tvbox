import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import {
  deleteUserFile,
  getUserFile,
  userFilePath,
} from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const file = await getUserFile(user.id, id)
    if (!file) throw new AppError(404, "not_found", "Archivo no encontrado")

    const filePath = userFilePath(file)
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      throw new AppError(404, "not_found", "Archivo no encontrado")
    }

    const { searchParams } = new URL(request.url)
    const download = searchParams.get("download") === "1"
    const asciiName = file.fileName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
    const disposition = `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`

    const stream = Readable.toWeb(
      createReadStream(filePath)
    ) as ReadableStream<Uint8Array>

    return new Response(stream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(size),
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
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
