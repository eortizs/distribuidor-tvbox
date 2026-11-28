import { validarLoteMetaInput, validarVersion } from "@/lib/inventario"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { actualizarLoteMeta } from "@/server/inventario/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

type RouteContext = { params: Promise<{ id: string }> }

/**
 * PATCH /api/inventario/lotes/[id] { lote?, caducidad?, condicion?,
 * ubicacion?, version } → lote actualizado. Reemplazo completo de los
 * METADATOS con compare-and-swap: si la fila cambió en otro dispositivo
 * (o por un movimiento) responde 409 con la versión vigente en
 * `details.lote`. La cantidad jamás pasa por aquí: solo con movimientos.
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const raw = body.body
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: se esperaba { lote?, caducidad?, condicion?, ubicacion?, version }."
      )
    }
    const data = raw as Record<string, unknown>
    const version = validarVersion(data.version)
    if (version === null) {
      throw new AppError(
        422,
        "invalid_request",
        "La versión del lote es inválida."
      )
    }
    const validacion = validarLoteMetaInput(raw)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const { id } = await ctx.params
    const lote = await actualizarLoteMeta(
      id,
      validacion.meta,
      version,
      user.id
    )

    return Response.json(
      { ok: true, data: lote },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
