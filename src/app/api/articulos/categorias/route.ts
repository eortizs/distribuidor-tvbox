import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { listarCategorias } from "@/server/articulos/repository"
import { errorResponse } from "@/server/http"

export const instant = false

/** GET /api/articulos/categorias?estado=active|archived|all → categorías ya
 * usadas en ese estado (para el autocompletado del formulario y el filtro
 * del listado, que sigue al estado que está viendo la vista). */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const estado = new URL(request.url).searchParams.get("estado")
    const categorias = await listarCategorias(
      estado === "archived" || estado === "all" ? estado : "active"
    )

    return Response.json(
      { ok: true, data: categorias },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
