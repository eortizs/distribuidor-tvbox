import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { refundOrder, toMpOrderPublic } from "@/server/mercadopago/service"
import { readJsonBody } from "@/server/http"

/**
 * Reembolsa el cobro total de una orden con renovación fallida (solo admin).
 * El reclamo atómico hacia `refunding` bloquea reintentos de renovación en
 * paralelo y dobles ejecuciones; el resultado es `refunded` o, si MP rechaza
 * la devolución, la orden vuelve a `renewal_failed` y el error viaja aquí
 * traducido (saldo insuficiente, fuera de la ventana de 180 días, etc.).
 */
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
            message: "Solo un administrador puede reembolsar cobros.",
          },
        },
        { status: 403 }
      )
    }

    const reason = await readJsonBody(request)
      .then((parsed) =>
        parsed.ok
          ? typeof (parsed.body as { reason?: unknown }).reason === "string"
            ? ((parsed.body as { reason: string }).reason.trim() || null)
            : null
          : null
      )
      .catch(() => null)

    const { id } = await params
    const fresh = await refundOrder({
      orderId: id,
      adminUserId: user.id,
      adminUsername: user.username,
      reason: reason ? reason.slice(0, 500) : null,
    })

    return Response.json({ ok: true, data: { order: toMpOrderPublic(fresh) } })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
