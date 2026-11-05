import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  annotateImageGeneration,
  checkAnnotationRateLimit,
} from "@/server/images/service"
import {
  MAX_ANNOTATION_BODY_BYTES,
  sanitizeAnnotationInput,
} from "@/server/images/annotations"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Guarda una copia anotada de una imagen de Galería: recibe trazos
 * normalizados (no un archivo ni un SVG) y el servidor compone el resultado
 * sobre el original con Sharp. La copia es un elemento nuevo de Galería con
 * costo NULL, sin pasar por el flujo de generación.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params

    if (!checkAnnotationRateLimit(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Has guardado muchos dibujos en un minuto. Inténtalo de nuevo en un momento."
      )
    }

    // La lectura se corta de verdad al llegar al tope del cuerpo.
    const body = await readJsonBody(request, MAX_ANNOTATION_BODY_BYTES)
    if (!body.ok) return body.response

    const parsed = sanitizeAnnotationInput(body.body)
    if (!parsed.ok) {
      throw new AppError(
        422,
        "invalid_request",
        "Solicitud inválida: se esperaba { strokes: [{ color: \"#rrggbb\", width: number, points: [x, y][] }] } con al menos un trazo."
      )
    }

    const image = await annotateImageGeneration(user.id, id, parsed.strokes)

    return Response.json({ ok: true, data: { image } }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
