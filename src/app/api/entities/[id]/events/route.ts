import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { assertPropietarioTicket } from "@/server/tickets/repository"
import { getEntity, getEntityEvents } from "@/server/umejson/repository"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const scope =
      user.role === "distribuidor"
        ? { ownedByDistribuidorId: user.id }
        : undefined
    // El journal de un ticket es privado del propietario: se comprueba la
    // pertenencia antes de leer los eventos (404 sin revelar existencia).
    const entity = await getEntity(id, scope)
    assertPropietarioTicket(entity.doc, user.id)
    const events = await getEntityEvents(id, scope)
    return Response.json({ ok: true, data: events })
  } catch (error) {
    return errorResponse(error)
  }
}
