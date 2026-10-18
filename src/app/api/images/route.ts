import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { checkImageRateLimit, generateImage, listImageGenerations, sanitizeImageInput } from "@/server/images/service"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

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
        `Solicitud inválida: se esperaba { prompt: string (1-${2000} caracteres) } con aspecto y calidad opcionales.`
      )
    }

    const result = await generateImage(user.id, {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      quality: input.quality,
    })

    return Response.json({ ok: true, data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
