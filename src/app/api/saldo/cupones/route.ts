import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { createSaldoCouponOrder } from "@/server/mercadopago/saldo-orders"
import { readJsonBody } from "@/server/http"

interface SaldoCouponBody {
  amount?: unknown
  code?: unknown
  request_id?: unknown
}

/**
 * Abono pagado con cupón QA (0000): valida el código y los topes de canjes
 * por comprador, crea la orden ya pagada y acredita el saldo al instante
 * (la acreditación es local). Idempotente por `request_id`: un reintento
 * devuelve la orden original en lugar de canjear dos veces.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as SaldoCouponBody

    const code = typeof body.code === "string" ? body.code.trim() : ""
    if (code.length === 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el código del cupón.",
          },
        },
        { status: 422 }
      )
    }

    const requestId =
      typeof body.request_id === "string" ? body.request_id.trim() : ""
    if (requestId.length < 8 || requestId.length > 100) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el identificador de la solicitud del canje.",
          },
        },
        { status: 422 }
      )
    }

    if (body.amount === undefined) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el monto a abonar.",
          },
        },
        { status: 422 }
      )
    }

    const result = await createSaldoCouponOrder({
      buyerUserId: user.id,
      buyerUsername: user.username,
      code,
      requestId,
      amountMxn: body.amount,
    })

    return Response.json({
      ok: true,
      data: {
        order_id: result.orderId,
        status: result.status,
        amount: result.creditAmount,
        currency: result.currency,
        saldo: result.saldo,
        error: result.error,
      },
    })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
