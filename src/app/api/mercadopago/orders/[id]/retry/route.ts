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
 * Admin: cualquier orden; su reintento es decisión humana y CRUZA la guardia
 * anti-doble-renovación (puede apilar un mes sabiendo que la suma existe).
 * Comprador: solo sus propias órdenes con renovación fallida, y su reintento
 * SIGUE sujeto a la guardia (trigger `buyer_retry`): si el cliente ya fue
 * renovado por otra orden pagada hace segundos/minutos, el reintento del
 * comprador no empuja una renovación doble — el admin decide. No vuelve a
 * cobrar: re-ejecuta la renovación con la misma clave de idempotencia.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiUser("flujo")
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

    const fresh = await retryOrderRenewal(id, {
      // Solo el ADMIN cruza la guardia anti-doble-renovación: un reintento
      // del comprador con renovación reciente del cliente se bloquea igual
      // (el comprador ve el motivo claro en el error de la orden).
      admin: user.role === "admin",
    })
    return Response.json({ ok: true, data: { order: toMpOrderPublic(fresh) } })
  } catch (error) {
    if (error instanceof FlujoApiError) return flujoErrorResponse(error)
    return mpErrorResponse(error)
  }
}
