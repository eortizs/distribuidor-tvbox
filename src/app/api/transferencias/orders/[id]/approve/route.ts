import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { FlujoApiError } from "@/server/flujotv/errors"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { approveTransferOrder } from "@/server/mercadopago/service"

/**
 * Aprueba una transferencia pendiente (solo admin): reclama la orden hacia
 * `paid` y renueva la licencia en el panel FlujoTV. Idempotente por la clave
 * determinista de la orden; con renovación fallida queda `renewal_failed`
 * para el reintento admin existente.
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
            message: "Solo un administrador puede aprobar transferencias.",
          },
        },
        { status: 403 }
      )
    }

    const { id } = await params
    const order = await approveTransferOrder(id)
    return Response.json({
      ok: true,
      data: {
        order_id: order.id,
        status: order.status,
        // Vencimiento nuevo verificado en el panel: la confirmación del
        // admin lo muestra como evidencia de que la renovación aplicó.
        verified_expires_at: order.renewal_verified_expires_at,
      },
    })
  } catch (error) {
    if (error instanceof FlujoApiError) return flujoErrorResponse(error)
    return mpErrorResponse(error)
  }
}
