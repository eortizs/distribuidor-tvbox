import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { extraerTicket } from "@/server/tickets/service"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Análisis de la foto con el modelo configurado (TICKET_SCAN_MODEL vía AI
 * Gateway). Solo borradores sin datos, un intento a la vez (lease en DB) y
 * con límite por usuario. Un fallo deja el intento como `failed` con
 * mensaje claro y la foto intacta; se puede reintentar.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const vista = await extraerTicket(user, id, request.signal)

    return Response.json(
      { ok: true, data: vista },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
