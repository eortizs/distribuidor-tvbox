import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  MercadoPagoError,
  mpErrorResponse,
} from "@/server/mercadopago/errors"
import { getMpOrder } from "@/server/mercadopago/service"
import { listOrderEvents } from "@/server/telemetry/order-events"

/**
 * Bitácora de transacciones de una orden (solo admin): la secuencia de
 * eventos de `mp_order_events` que reconstruye cada intento de renovación
 * — inicio, respuesta del panel, verificación, reintentos agendados y
 * resultado final, cada uno con su `transaction_id`. Es la herramienta de
 * seguimiento cuando un comprador reporta un caso («el cupón se aceptó pero
 * la renovación no se confirmó»): demuestra qué pasó y cuándo.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()
    if (user.role !== "admin") {
      return Response.json(
        {
          ok: false,
          error: {
            code: "forbidden",
            message: "Solo el administrador puede ver la bitácora.",
          },
        },
        { status: 403 }
      )
    }

    const { id } = await params
    const order = await getMpOrder(id)
    if (!order) {
      throw new MercadoPagoError(404, "not_found", "La orden no existe.")
    }

    const events = await listOrderEvents(order.id)
    return Response.json({
      ok: true,
      data: {
        order: { id: order.id, status: order.status, error: order.error },
        events,
      },
    })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
