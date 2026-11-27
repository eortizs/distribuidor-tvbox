import {
  parsearStatus,
  validarArticuloInput,
  validarVersion,
} from "@/lib/articulos"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  actualizarArticulo,
  obtenerArticulo,
} from "@/server/articulos/repository"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

type RouteContext = { params: Promise<{ id: string }> }

/** GET /api/articulos/[id] → artículo completo (para editar). */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const articulo = await obtenerArticulo(id)

    return Response.json(
      { ok: true, data: articulo },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/articulos/[id] { sku, nombre, ..., version, status? } →
 * artículo actualizado. Reemplazo completo con compare-and-swap: si la fila
 * cambió en otro dispositivo responde 409 con la versión vigente en
 * `details.articulo`. `status` opcional para archivar/restaurar en el
 * mismo PATCH (sin DELETE: el catálogo nunca pierde filas).
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
        "Solicitud inválida: se esperaba { sku, nombre, ..., version, status? }."
      )
    }
    const data = raw as Record<string, unknown>
    const version = validarVersion(data.version)
    if (version === null) {
      throw new AppError(
        422,
        "invalid_request",
        "La versión del artículo es inválida."
      )
    }
    let status: "active" | "archived" | undefined
    if (data.status !== undefined) {
      const parsed = parsearStatus(data.status)
      if (!parsed) {
        throw new AppError(
          422,
          "status_invalido",
          "El estado debe ser active o archived."
        )
      }
      status = parsed
    }
    const validacion = validarArticuloInput(raw)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const { id } = await ctx.params
    const articulo = await actualizarArticulo(
      id,
      validacion.articulo,
      version,
      user.id,
      status
    )

    return Response.json(
      { ok: true, data: articulo },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
