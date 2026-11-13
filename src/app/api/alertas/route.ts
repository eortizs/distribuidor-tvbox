import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  createAlert,
  listAlertsSummary,
} from "@/server/alertas/service"
import { alertsConfigured } from "@/server/alertas/llm"
import { AppError } from "@/server/umejson/types"

/**
 * Módulo Alertas: listado y alta. La creación toma la spec ya interpretada
 * (posiblemente ajustada por el usuario en el preview) y la revalida en el
 * servidor contra el catálogo: nunca vuelve a llamar al LLM.
 */

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const alerts = await listAlertsSummary(user.id)

    return Response.json(
      { ok: true, data: { alerts, llmConfigured: alertsConfigured() } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!alertsConfigured()) {
      throw alertasNoConfigurada()
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const input = body.body as {
      texto?: unknown
      alerta?: unknown
      attachmentIds?: unknown
    }
    const alert = await createAlert(user.id, {
      texto: input.texto,
      spec: input.alerta,
      attachmentIds: input.attachmentIds,
    })

    return Response.json(
      { ok: true, data: { alert } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

function alertasNoConfigurada(): AppError {
  return new AppError(
    500,
    "alertas_llm_not_configured",
    "El módulo de alertas no está configurado en el servidor (falta GEMINI_API_KEY)."
  )
}
