import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { ENTITY_NAME_TICKET } from "@/lib/tickets"
import { errorResponse } from "@/server/http"
import { listEntities } from "@/server/umejson/repository"

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const limitParam = Number(searchParams.get("limit") ?? "10")
    const offsetParam = Number(searchParams.get("offset") ?? "0")

    const result = await listEntities({
      entityName: searchParams.get("entityName") ?? undefined,
      // Los tickets van por su propio módulo (/api/tickets), con privacidad
      // estricta por propietario: nunca por este listado genérico.
      excludeEntityName: ENTITY_NAME_TICKET,
      q: searchParams.get("q") ?? undefined,
      distribuidorId:
        user.role === "distribuidor" ? user.id : undefined,
      limit: Number.isFinite(limitParam) ? limitParam : 10,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
