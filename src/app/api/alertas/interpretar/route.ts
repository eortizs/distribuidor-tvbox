import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import { alertsConfigured } from "@/server/alertas/llm"
import { interpretRequest, limpiarTextoAlerta } from "@/server/alertas/service"
import { MAX_ALERT_TEXT } from "@/lib/alertas"
import { AppError } from "@/server/umejson/types"

/**
 * Interpretación de la solicitud en lenguaje natural: devuelve el preview
 * estructurado (o la aclaración si no se entendió). No crea nada: la alta
 * pasa por POST /api/alertas con la spec confirmada.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!alertsConfigured()) {
      throw new AppError(
        500,
        "alertas_llm_not_configured",
        "El módulo de alertas no está configurado en el servidor (falta GEMINI_API_KEY)."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const input = body.body as { texto?: unknown; attachmentIds?: unknown }
    const texto = limpiarTextoAlerta(input.texto)
    if (texto === null) {
      throw new AppError(
        422,
        "invalid_request",
        `Describe tu alerta en hasta ${MAX_ALERT_TEXT} caracteres.`
      )
    }

    const resultado = await interpretRequest(user.id, texto, input.attachmentIds)

    return Response.json(
      { ok: true, data: resultado },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
