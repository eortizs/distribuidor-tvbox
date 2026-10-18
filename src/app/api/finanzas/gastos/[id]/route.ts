import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { softDeleteExpense, updateExpense } from "@/server/finanzas/gastos"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assertId(id: string): string {
  if (!UUID_RE.test(id)) {
    throw new AppError(400, "invalid_request", "Identificador de gasto inválido.")
  }
  return id
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    assertId(id)

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const patch = body.body as Record<string, unknown>
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: se esperaba un objeto con los campos a actualizar."
      )
    }

    const expense = await updateExpense(user.id, id, patch)

    return Response.json({ ok: true, data: expense })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    assertId(id)

    await softDeleteExpense(user.id, id)
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
