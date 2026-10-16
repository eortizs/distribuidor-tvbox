import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { getEntityEvents } from "@/server/umejson/repository"

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
    const events = await getEntityEvents(id, scope)
    return Response.json({ ok: true, data: events })
  } catch (error) {
    return errorResponse(error)
  }
}
