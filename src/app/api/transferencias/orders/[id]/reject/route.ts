import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { rejectTransferOrder } from "@/server/mercadopago/service"

/** Rechaza una transferencia pendiente (solo admin): sin pago, sin renovación. */
export async function POST(
  request: Request,
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
            message: "Solo un administrador puede rechazar transferencias.",
          },
        },
        { status: 403 }
      )
    }

    // Motivo opcional para la bitácora; el cuerpo puede venir vacío.
    let reason: string | null = null
    try {
      const body = (await request.json()) as { reason?: unknown }
      if (typeof body.reason === "string" && body.reason.trim()) {
        reason = body.reason.trim()
      }
    } catch {
      // Sin cuerpo JSON: se rechaza sin motivo.
    }

    const { id } = await params
    const order = await rejectTransferOrder(id, reason)
    return Response.json({
      ok: true,
      data: { order_id: order.id, status: order.status },
    })
  } catch (error) {
    // rejectTransferOrder es solo DB: ningún error FlujoApiError que mapear.
    return mpErrorResponse(error)
  }
}
