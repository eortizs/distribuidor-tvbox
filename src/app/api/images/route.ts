import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  checkImageRateLimit,
  deleteImageGenerations,
  generateImage,
  listImageGenerations,
  sanitizeImageInput,
} from "@/server/images/service"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"
import { MAX_REFERENCE_FILES } from "@/lib/attachments"

/** Tope de ids por borrado por lote: es el máximo de la galería paginada. */
const MAX_BATCH_DELETE = 200

/** Lee `{ ids: string[] }` del cuerpo de la petición. */
function sanitizeDeleteIds(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return []
  const { ids } = input as Record<string, unknown>
  if (!Array.isArray(ids)) return []
  if (ids.length > MAX_BATCH_DELETE) return []
  if (!ids.every((id) => typeof id === "string")) return []
  return ids as string[]
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const limitParam = Number(searchParams.get("limit") ?? "60")
    const offsetParam = Number(searchParams.get("offset") ?? "0")

    const result = await listImageGenerations(user.id, {
      limit: Number.isFinite(limitParam) ? limitParam : 60,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Borrado por lote: la galería en modo selección manda los ids de las
 * imágenes marcadas y el servidor las borra en una sola operación.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const ids = sanitizeDeleteIds(body.body)
    if (!ids.length) {
      throw new AppError(
        422,
        "invalid_request",
        `Solicitud inválida: se esperaba { ids: string[] } con al menos un id de imagen y hasta ${MAX_BATCH_DELETE}.`
      )
    }

    const result = await deleteImageGenerations(user.id, ids)

    return Response.json({
      ok: true,
      data: {
        deleted: result.deleted.length,
        missing: result.missing.length,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!checkImageRateLimit(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Has alcanzado el límite de imágenes por minuto. Inténtalo de nuevo en un momento."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const input = sanitizeImageInput(body.body)
    if (!input.ok) {
      throw new AppError(
        422,
        "invalid_request",
        `Solicitud inválida: se esperaba { prompt: string (1-${2000} caracteres) } con aspecto, modelo y hasta ${MAX_REFERENCE_FILES} imágenes de referencia opcionales.`
      )
    }

    const result = await generateImage(user.id, {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      level: input.level,
      referenceIds: input.referenceIds,
    })

    return Response.json({ ok: true, data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
