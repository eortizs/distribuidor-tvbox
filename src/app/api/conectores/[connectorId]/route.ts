import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { findConector, isConectorConectable } from "@/lib/conectores"
import { eliminarConexion } from "@/server/conectores/repository"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ connectorId: string }> }

/**
 * Desconecta un conector del usuario: revoca el token en el proveedor
 * (best effort) y elimina la conexión. Devuelve el catálogo sin datos de
 * tokens: el cliente refresca la pantalla con el resultado.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext
) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { connectorId } = await ctx.params
    const conector = findConector(connectorId)
    if (!conector || !isConectorConectable(connectorId)) {
      throw new AppError(404, "conector_invalido", "Conector no encontrado")
    }

    const deleted = await eliminarConexion(user.id, connectorId)
    if (!deleted) {
      throw new AppError(404, "conexion_inexistente", "No hay conexión que eliminar")
    }

    return Response.json(
      { ok: true, data: { connectorId } },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
