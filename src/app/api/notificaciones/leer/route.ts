import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  markNotificationsRead,
  parseNotificationSelection,
} from "@/server/notifications/service"

/**
 * Marca como leídas: `{ ids: uuid[] }` para un lote o sin `ids` para
 * marcar todas («Marcar leídas» de la campana). Devuelve el contador de
 * no leídas restante para actualizar la insignia sin refetch. Un array
 * inválido o sobredimensionado responde 422 y NUNCA se interpreta como
 * «todas».
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const selection = parseNotificationSelection(body.body)
    const unread = await markNotificationsRead(user.id, selection)

    return Response.json(
      { ok: true, data: { unread } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
