import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  deleteNotifications,
  listNotifications,
  parseNotificationSelection,
} from "@/server/notifications/service"

/**
 * Feed de la campana de notificaciones: últimas renovaciones del comprador
 * (resultado, usuario renovado y vencimiento nuevo) + contador de no leídas.
 */
export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const feed = await listNotifications(user.id)

    return Response.json(
      { ok: true, data: feed },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Borrado por lote (`{ ids: uuid[] }`) o total (sin `ids`): los botones
 * «Borrar» de la campana. Siempre acotado al propio usuario; un array
 * inválido o sobredimensionado responde 422 y NUNCA se interpreta como
 * «todas» (evita borrar el feed entero por una entrada malformada).
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const selection = parseNotificationSelection(body.body)
    const unread = await deleteNotifications(user.id, selection)

    return Response.json(
      { ok: true, data: { unread } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
