import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { listAnimationDeliverables } from "@/server/animaciones/service"
import { errorResponse } from "@/server/http"

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const limitParam = Number(searchParams.get("limit") ?? "60")
    const offsetParam = Number(searchParams.get("offset") ?? "0")

    const result = await listAnimationDeliverables(user.id, {
      limit: Number.isFinite(limitParam) ? limitParam : 60,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
