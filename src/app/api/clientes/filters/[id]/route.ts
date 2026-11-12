import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  deleteSavedClientFilter,
  updateSavedClientFilter,
} from "@/server/clientes/saved-filters"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

/** Borra uno de los filtros guardados del propio usuario. */
export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const deleted = await deleteSavedClientFilter(user.id, id)
    if (!deleted) {
      throw new AppError(404, "not_found", "Filtro no encontrado")
    }

    return Response.json({ ok: true, data: { id } })
  } catch (error) {
    return errorResponse(error)
  }
}

/** Edita uno de los filtros guardados del propio usuario (nombre, reglas y agrupación). */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    if (typeof body.body !== "object" || body.body === null) {
      throw new AppError(
        400,
        "invalid_request",
        "Se esperaba un objeto de filtro."
      )
    }

    const { id } = await ctx.params
    const updated = await updateSavedClientFilter(
      user.id,
      user.role === "admin",
      id,
      body.body
    )
    if (!updated) {
      throw new AppError(404, "not_found", "Filtro no encontrado")
    }

    return Response.json({ ok: true, data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}
