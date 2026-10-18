import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  checkRateLimit,
  sanitizeMessages,
  streamAssistantReply,
} from "@/server/asistente/llm"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!checkRateLimit(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Has alcanzado el límite de mensajes por minuto. Inténtalo de nuevo en un momento."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    // When data tools land, scope them here with the session user only:
    // distribuidorId: user.role === "distribuidor" ? user.id : undefined.
    const messages = sanitizeMessages(
      (body.body as { messages?: unknown }).messages
    )
    if (!messages) {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: se esperaba { messages: [{ role, content }] }."
      )
    }

    const stream = streamAssistantReply(messages, request.signal)

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
