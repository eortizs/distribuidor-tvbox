import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  checkEnhanceRateLimit,
  enhanceImagePrompt,
  sanitizeImageInput,
} from "@/server/images/service"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"
import { MAX_REFERENCE_FILES } from "@/lib/attachments"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!checkEnhanceRateLimit(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Has alcanzado el límite de mejoras por minuto. Inténtalo de nuevo en un momento."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const input = sanitizeImageInput(body.body)
    if (!input.ok) {
      throw new AppError(
        422,
        "invalid_request",
        `Solicitud inválida: se esperaba { prompt: string } con aspecto, calidad y hasta ${MAX_REFERENCE_FILES} imágenes de referencia opcionales.`
      )
    }

    const result = await enhanceImagePrompt(user.id, {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      quality: input.quality,
      referenceIds: input.referenceIds,
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
