import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import { validarNotaInput, validarVersion } from "@/lib/notas"
import {
  actualizarNota,
  eliminarNota,
  obtenerNota,
} from "@/server/notas/repository"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

/** GET /api/notas/[id] → nota completa (para editar). */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser("general")
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const nota = await obtenerNota(user.id, id)

    return Response.json(
      { ok: true, data: nota },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/notas/[id] { title?, body?, pinned?, version } → nota
 * actualizada. El `version` es el compare-and-swap: si la nota cambió en
 * otro dispositivo responde 409 con la nota vigente en `details.nota`.
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser("general")
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const raw = body.body
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: se esperaba { title?, body?, pinned?, version }."
      )
    }
    const version = validarVersion((raw as Record<string, unknown>).version)
    if (version === null) {
      throw new AppError(
        422,
        "invalid_request",
        "La versión de la nota es inválida."
      )
    }
    const validacion = validarNotaInput(raw)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const { id } = await ctx.params
    const nota = await actualizarNota(user.id, id, validacion.nota, version)

    return Response.json(
      { ok: true, data: nota },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/** DELETE /api/notas/[id] → { ok: true }. */
export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser("general")
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    await eliminarNota(user.id, id)

    return Response.json({ ok: true, data: { id } })
  } catch (error) {
    return errorResponse(error)
  }
}
