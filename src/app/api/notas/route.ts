import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import { validarNotaInput } from "@/lib/notas"
import {
  crearNota,
  listarNotas,
} from "@/server/notas/repository"
import { AppError } from "@/server/umejson/types"

/**
 * GET /api/notas?q= → listado (cuerpo truncado). La búsqueda aplica con
 * 2+ caracteres tras recortar; menos que eso devuelve el listado completo.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser("general")
    if (!user) return unauthorizedResponse()

    const q = new URL(request.url).searchParams.get("q") ?? undefined
    const notas = await listarNotas(user.id, q)

    return Response.json(
      { ok: true, data: notas },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST /api/notas { title?, body?, pinned? } → nota creada. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser("general")
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const validacion = validarNotaInput(body.body)
    if (!validacion.ok) {
      throw new AppError(422, validacion.code, validacion.error)
    }

    const nota = await crearNota(user.id, validacion.nota)

    return Response.json(
      { ok: true, data: nota },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
