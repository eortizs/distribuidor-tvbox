import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import { corregirTicket, obtenerVista, validarDatosCorregidos } from "@/server/tickets/service"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PatchBody {
  version?: unknown
  datos?: unknown
  confirmar?: unknown
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    if (!UUID_RE.test(id)) {
      throw new AppError(404, "not_found", "Ticket no encontrado")
    }
    const vista = await obtenerVista(user.id, id)
    if (!vista) throw new AppError(404, "not_found", "Ticket no encontrado")

    return Response.json(
      { ok: true, data: vista },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Corrección y confirmación por el propietario, con compare-and-swap por
 * `version`. `datos` son los campos editados (validados y normalizados en
 * servidor); `confirmar` exige comercio, fecha, moneda y total conocidos.
 * Corregir un ticket confirmado lo devuelve a revisión.
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    if (!UUID_RE.test(id)) {
      throw new AppError(404, "not_found", "Ticket no encontrado")
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as PatchBody
    const version = Number(body.version)
    if (!Number.isInteger(version) || version < 1) {
      throw new AppError(
        422,
        "validation_error",
        "body.version (integer >= 1) es obligatorio para el bloqueo optimista."
      )
    }
    const confirmar = body.confirmar === true
    const traeDatos = body.datos !== undefined && body.datos !== null
    if (!traeDatos && !confirmar) {
      throw new AppError(
        422,
        "validation_error",
        "Envía 'datos' corregidos, 'confirmar': true, o ambos."
      )
    }

    const vista = await corregirTicket({
      user,
      entityId: id,
      expectedVersion: version,
      datos: traeDatos ? validarDatosCorregidos(body.datos) : undefined,
      confirmar,
    })

    return Response.json(
      { ok: true, data: vista },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
