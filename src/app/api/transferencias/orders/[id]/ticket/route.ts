import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { getMpOrder } from "@/server/mercadopago/service"
import { getUserFile, userFilePath } from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Sirve el ticket de una transferencia (solo admin, `inline`). El archivo
 * pertenece al comprador, así que se resuelve a través de la orden y no por
 * su id de `user_files`, que la ruta de archivos niega a terceros.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()
    if (user.role !== "admin") {
      throw new AppError(
        403,
        "forbidden",
        "Solo un administrador puede ver los tickets."
      )
    }

    const { id } = await ctx.params
    const order = await getMpOrder(id)
    if (!order || !order.ticket_file_id || !order.buyer_user_id) {
      throw new AppError(404, "not_found", "La orden no tiene ticket.")
    }

    const file = await getUserFile(order.buyer_user_id, order.ticket_file_id)
    if (!file) throw new AppError(404, "not_found", "El ticket no existe.")

    const filePath = userFilePath(file)
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      throw new AppError(404, "not_found", "El ticket no existe.")
    }

    const asciiName = file.fileName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
    const stream = Readable.toWeb(
      createReadStream(filePath)
    ) as ReadableStream<Uint8Array>

    return new Response(stream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(size),
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
