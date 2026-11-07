import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import {
  getMpOrder,
  reconcilePendingOrder,
  toMpOrderPublic,
} from "@/server/mercadopago/service"

/**
 * Estado de una orden de pago, para el sondeo del aviso de retorno en
 * `/clientes`. Solo el comprador (o un admin) puede verla. Si la orden lleva
 * pendiente demasiado tiempo, intenta conciliar contra la API de Mercado Pago
 * por si el webhook se perdió.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await params
    const order = await getMpOrder(id)
    if (!order) {
      return Response.json(
        {
          ok: false,
          error: { code: "not_found", message: "La orden no existe." },
        },
        { status: 404 }
      )
    }

    const isOwner =
      order.buyer_user_id !== null && order.buyer_user_id === user.id
    if (!isOwner && user.role !== "admin") {
      return Response.json(
        {
          ok: false,
          error: { code: "forbidden", message: "No puedes ver esta orden." },
        },
        { status: 403 }
      )
    }

    const reconciled = await reconcilePendingOrder(order)
    return Response.json({ ok: true, data: { order: toMpOrderPublic(reconciled) } })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
