import { validarMovimientoInput } from "@/lib/inventario"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { registrarMovimiento } from "@/server/inventario/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/inventario/lotes/[id]/movimientos { kind, cantidad |
 * cantidadObjetivo, motivo? } → { lote, movimiento }. El único camino por
 * el que cambia el stock: el repositorio bloquea la fila, calcula el delta
 * y escribe movimiento + balance en una transacción. 422
 * `stock_insuficiente` (salida sin existencias) y `sin_cambios` (ajuste
 * que no mueve nada).
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const validacion = validarMovimientoInput(body.body)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const { id } = await ctx.params
    const resultado = await registrarMovimiento(
      id,
      validacion.movimiento,
      user.id
    )

    return Response.json(
      { ok: true, data: resultado },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
