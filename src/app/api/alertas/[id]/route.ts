import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  deleteAlertById,
  getAlertDetail,
  patchAlert,
  type PatchAlertInput,
} from "@/server/alertas/service"

type RouteContext = { params: Promise<{ id: string }> }

/** Detalle de la alerta con su historial de revisiones. */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const detail = await getAlertDetail(user.id, id)

    return Response.json(
      { ok: true, data: detail },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Ajustes: pausar/reanudar/reactivar y cambiar el schedule (frecuencia,
 * hora, día de la semana, modo, fecha del recordatorio). El servidor
 * revalida todo contra el catálogo y recalcula la próxima revisión.
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const { id } = await ctx.params
    const input = body.body as PatchAlertInput
    const alert = await patchAlert(user.id, id, input)

    return Response.json(
      { ok: true, data: { alert } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    await deleteAlertById(user.id, id)

    return Response.json({ ok: true, data: { id } })
  } catch (error) {
    return errorResponse(error)
  }
}
