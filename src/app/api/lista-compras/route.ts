import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  aplicarMutacion,
  obtenerLista,
} from "@/server/lista-compras/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

function parseEntradaMutacion(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(
      400,
      "invalid_request",
      "Solicitud inválida: se esperaba { revision, requestId, confirmar, ops }."
    )
  }
  const raw = body as Record<string, unknown>
  const revision = Number(raw.revision)
  if (!Number.isInteger(revision) || revision < 0) {
    throw new AppError(
      422,
      "invalid_request",
      "La revisión de la lista es inválida."
    )
  }
  const requestId = raw.requestId
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 64) {
    throw new AppError(
      422,
      "invalid_request",
      "El identificador de la petición es inválido."
    )
  }
  if (!Array.isArray(raw.ops)) {
    throw new AppError(
      422,
      "invalid_request",
      "Se esperaba una lista de operaciones."
    )
  }
  return {
    revision,
    requestId,
    confirmar: raw.confirmar === true,
    ops: raw.ops,
  }
}

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const snapshot = await obtenerLista(user.id)
    return Response.json(
      { ok: true, data: snapshot },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const snapshot = await aplicarMutacion(
      user.id,
      parseEntradaMutacion(body.body)
    )
    return Response.json(
      { ok: true, data: snapshot },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
