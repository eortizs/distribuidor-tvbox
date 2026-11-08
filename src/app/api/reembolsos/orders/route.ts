import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { listRefundOrders } from "@/server/mercadopago/service"

/**
 * Órdenes de Mercado Pago reembolsables y reembolsadas (solo admin): las
 * cobradas con renovación fallida (`renewal_failed`), en reembolso
 * (`refunding`) o cerradas (`refunded`), las más recientes primero. La
 * lectura concilia además las `refunding` estancadas contra la API de MP.
 */
export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()
    if (user.role !== "admin") {
      return Response.json(
        {
          ok: false,
          error: {
            code: "forbidden",
            message: "Solo un administrador puede revisar reembolsos.",
          },
        },
        { status: 403 }
      )
    }

    const orders = await listRefundOrders()
    return Response.json({ ok: true, data: { orders } })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
