import {
  ARTICULOS_PAGE_SIZE_DEFAULT,
  validarArticuloInput,
} from "@/lib/articulos"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  crearArticulo,
  listarArticulos,
  type EstadoFiltro,
} from "@/server/articulos/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

/**
 * Catálogo de artículos del tenant (RLS): propietario y sucursales ven y
 * editan lo mismo. GET lista con búsqueda (2+ caracteres), filtros,
 * ordenamiento whitelist y paginación de servidor. POST crea con el tope
 * de 5 000 artículos por tenant (advisory lock).
 */

function estadoDe(raw: string | null): EstadoFiltro {
  return raw === "archived" || raw === "all" ? raw : "active"
}

function booleanoDe(raw: string | null): boolean | undefined {
  if (raw === "true") return true
  if (raw === "false") return false
  return undefined
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const params = new URL(request.url).searchParams
    const dir = params.get("dir") === "asc" ? "asc" : "desc"
    const { articulos, total } = await listarArticulos({
      q: params.get("q") ?? undefined,
      status: estadoDe(params.get("status")),
      categoria: params.get("categoria") ?? undefined,
      disponible: booleanoDe(params.get("disponible")),
      page: Number(params.get("page")) || 1,
      pageSize:
        Number(params.get("pageSize")) || ARTICULOS_PAGE_SIZE_DEFAULT,
      sort: params.get("sort") ?? undefined,
      dir,
    })

    return Response.json(
      { ok: true, data: articulos, total },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const validacion = validarArticuloInput(body.body)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const articulo = await crearArticulo(validacion.articulo, user.id)

    return Response.json(
      { ok: true, data: articulo },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
