import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  checkRateLimitInterpretar,
  interpretarInstruccion,
  limpiarTextoInterprete,
} from "@/server/lista-compras/llm"
import { obtenerLista } from "@/server/lista-compras/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!checkRateLimitInterpretar(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Has alcanzado el límite de interpretaciones por minuto. Inténtalo de nuevo en un momento."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const texto = limpiarTextoInterprete(
      (body.body as { texto?: unknown }).texto
    )
    if (texto === null) {
      throw new AppError(
        422,
        "invalid_request",
        `Escribe una instrucción de hasta 4000 caracteres.`
      )
    }

    // Snapshot leído en servidor: el cliente nunca manda la lista.
    const snapshot = await obtenerLista(user.id)
    const resultado = await interpretarInstruccion(
      user.id,
      texto,
      snapshot,
      request.signal
    )

    return Response.json(
      { ok: true, data: resultado },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
