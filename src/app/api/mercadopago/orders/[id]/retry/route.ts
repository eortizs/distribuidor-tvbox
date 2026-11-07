import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { FlujoApiError } from "@/server/flujotv/errors"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { MercadoPagoError, mpErrorResponse } from "@/server/mercadopago/errors"
import { retryOrderRenewal, toMpOrderPublic } from "@/server/mercadopago/service"

/**
 * Reintenta la renovación de una orden `renewal_failed` (pago ya cobrado por
 * Mercado Pago cuya renovación en el panel falló). Solo admin. No vuelve a
 * cobrar: re-ejecuta la renovación con la misma clave de idempotencia.
 */
export async function POST(
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
            message: "Solo un administrador puede reintentar renovaciones.",
          },
        },
        { status: 403 }
      )
    }

    const { id } = await params
    const order = await retryOrderRenewal(id)
    return Response.json({ ok: true, data: { order: toMpOrderPublic(order) } })
  } catch (error) {
    if (error instanceof FlujoApiError) return flujoErrorResponse(error)
    if (error instanceof MercadoPagoError) return mpErrorResponse(error)
    return mpErrorResponse(error)
  }
}
