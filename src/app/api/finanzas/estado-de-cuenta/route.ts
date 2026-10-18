import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { summarizeExpenses } from "@/server/finanzas/gastos"
import { errorResponse } from "@/server/http"

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const result = await summarizeExpenses(user.id, {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
