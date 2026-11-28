import { validarLoteInput } from "@/lib/inventario"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  crearLote,
  listarLotes,
  resumenInventario,
  type FiltroCaducidad,
  type FiltroCondicion,
} from "@/server/inventario/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

/**
 * Inventario del tenant (RLS): propietario y sucursales ven y gestionan lo
 * mismo. GET devuelve los lotes (con búsqueda 2+ caracteres y filtros de
 * condición/caducidad) y el resumen del encabezado. POST crea un lote
 * ligado a un artículo del catálogo, con tope de lotes por tenant
 * (advisory lock) y su entrada de alta si trae cantidad inicial.
 */

function condicionDe(raw: string | null): FiltroCondicion {
  return raw === "nuevo" || raw === "usado" || raw === "danado" ? raw : "all"
}

function caducidadDe(raw: string | null): FiltroCaducidad {
  return raw === "vencidos" || raw === "por_vencer" ? raw : "all"
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const params = new URL(request.url).searchParams
    const [listado, resumen] = await Promise.all([
      listarLotes({
        q: params.get("q") ?? undefined,
        condicion: condicionDe(params.get("condicion")),
        caducidad: caducidadDe(params.get("caducidad")),
      }),
      resumenInventario(),
    ])

    return Response.json(
      { ok: true, data: listado.lotes, total: listado.total, resumen },
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

    const validacion = validarLoteInput(body.body)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const lote = await crearLote(validacion.lote, user.id)

    return Response.json(
      { ok: true, data: lote },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
