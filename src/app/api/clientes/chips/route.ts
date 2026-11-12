import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { getChipLayout, setChipLayout } from "@/server/clientes/chip-layout"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

/**
 * Orden manual de la hilera de filtros de `/clientes` («Reordenar» del menú
 * del chip): GET devuelve la lista de claves de chips guardada (null si
 * nunca se reordenó) y PUT persiste la lista completa en su orden nuevo.
 */
export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const order = await getChipLayout(user.id)
    return Response.json({
      ok: true,
      data: { order: order.length > 0 ? order : null },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    if (typeof body.body !== "object" || body.body === null) {
      throw new AppError(
        400,
        "invalid_request",
        "Se esperaba un objeto con el orden."
      )
    }

    const order = (body.body as { order?: unknown }).order
    if (!Array.isArray(order) || order.some((key) => typeof key !== "string")) {
      throw new AppError(
        422,
        "invalid_order",
        "Se esperaba una lista de claves de chip."
      )
    }

    await setChipLayout(user.id, order as string[])
    return Response.json({ ok: true, data: { count: order.length } })
  } catch (error) {
    return errorResponse(error)
  }
}
