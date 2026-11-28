import { esArticuloIdValido } from "@/lib/articulos"
import { esUuidValido } from "@/lib/inventario"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  MOVIMIENTOS_PAGE_SIZE_DEFAULT,
  listarMovimientos,
} from "@/server/inventario/repository"
import { errorResponse } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

/**
 * GET /api/inventario/movimientos → kardex paginado (más reciente primero).
 * Filtros opcionales: `loteId` (kardex de un lote) o `articuloId` (kardex
 * de un artículo); sin filtros lista los movimientos del tenant.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const params = new URL(request.url).searchParams
    const loteId = params.get("loteId") ?? undefined
    const articuloId = params.get("articuloId") ?? undefined
    if (loteId !== undefined && !esUuidValido(loteId)) {
      throw new AppError(422, "lote_invalido", "El id del lote es inválido.")
    }
    if (
      articuloId !== undefined &&
      !esArticuloIdValido(articuloId)
    ) {
      throw new AppError(
        422,
        "articulo_invalido",
        "El id del artículo es inválido."
      )
    }

    const { movimientos, total } = await listarMovimientos({
      loteId,
      articuloId,
      page: Number(params.get("page")) || 1,
      pageSize:
        Number(params.get("pageSize")) || MOVIMIENTOS_PAGE_SIZE_DEFAULT,
    })

    return Response.json(
      { ok: true, data: movimientos, total },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
