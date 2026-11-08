import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { FlujoApiError } from "@/server/flujotv/errors"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import {
  getMpOrder,
  retryOrderRenewal,
  toMpOrderPublic,
} from "@/server/mercadopago/service"

/**
 * Reintenta la renovación de una orden `renewal_failed` o `paid` varada.
 * Admin: cualquier orden. Comprador: solo sus propias órdenes con renovación
 * fallida (el pago/cupón ya quedó registrado y la clave de idempotencia
 * determinista evita duplicar meses). No vuelve a cobrar: re-ejecuta la
 * renovación con la misma clave de idempotencia.
 */
export async function POST(
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
    if (user.role !== "admin") {
      const isBuyer = order.buyer_user_id === user.id
      if (!isBuyer) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "forbidden",
              message: "Solo un administrador puede reintentar esta orden.",
            },
          },
          { status: 403 }
        )
      }
      if (order.status !== "renewal_failed") {
        return Response.json(
          {
            ok: false,
            error: {
              code: "forbidden",
              message:
                "Solo puedes reintentar órdenes tuyas con renovación fallida.",
            },
          },
          { status: 403 }
        )
      }
    }

    const fresh = await retryOrderRenewal(id)
    return Response.json({ ok: true, data: { order: toMpOrderPublic(fresh) } })
  } catch (error) {
    if (error instanceof FlujoApiError) return flujoErrorResponse(error)
    return mpErrorResponse(error)
  }
}
