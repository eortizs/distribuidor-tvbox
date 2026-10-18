import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { createExpense, listExpenses, validateExpenseInput } from "@/server/finanzas/gastos"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const limitParam = Number(searchParams.get("limit") ?? "25")
    const offsetParam = Number(searchParams.get("offset") ?? "0")

    const result = await listExpenses(user.id, {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      limit: Number.isFinite(limitParam) ? limitParam : 25,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const input = body.body as Record<string, unknown>
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: se esperaba un objeto de gasto."
      )
    }

    const expense = await createExpense(
      user.id,
      validateExpenseInput(input),
      "user"
    )

    return Response.json({ ok: true, data: expense }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
