import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  createSavedClientFilter,
  listSavedClientFilters,
} from "@/server/clientes/saved-filters"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

/**
 * Filtros compuestos guardados de `/clientes` (tabla
 * `client_saved_filters`), por usuario: GET lista los suyos y POST crea uno
 * con el payload validado por `src/lib/client-filters.ts`.
 */

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const filters = await listSavedClientFilters(
      user.id,
      user.role === "admin"
    )
    return Response.json({ ok: true, data: filters })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
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

    const filter = await createSavedClientFilter(
      user.id,
      user.role === "admin",
      body.body
    )
    return Response.json({ ok: true, data: filter }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
