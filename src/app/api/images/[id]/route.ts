import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { deleteImageGeneration } from "@/server/images/service"
import { errorResponse } from "@/server/http"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const deleted = await deleteImageGeneration(user.id, id)
    if (!deleted) {
      throw new AppError(404, "not_found", "Generación no encontrada")
    }

    return Response.json({ ok: true, data: { id } })
  } catch (error) {
    return errorResponse(error)
  }
}
