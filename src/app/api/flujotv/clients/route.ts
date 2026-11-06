import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { listFlujoClients } from "@/server/flujotv/service"
import {
  resolveClientScope,
  scopeFlujoClients,
} from "@/server/flujotv/scope"

function readNumber(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(Math.trunc(parsed), max)
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const params = new URL(request.url).searchParams
    const query = params.get("q")?.trim() || undefined
    const limit = readNumber(params.get("limit"), 200, 500)
    const offset = readNumber(params.get("offset"), 0, 100_000)
    const includeCredentials = params.get("include_credentials") === "true"
    const full = params.get("full") === "true"

    const result = await listFlujoClients({
      query,
      limit,
      offset,
      includeCredentials,
      full,
    })

    // El perfil distribuidor solo recibe los clientes asignados a su
    // reseller ligado; el total reportado se ajusta al listado filtrado.
    const scope = await resolveClientScope(user)
    const clients = await scopeFlujoClients(result.clients, scope)

    return Response.json({
      ok: true,
      data: {
        clients,
        total: scope.kind === "all" ? result.total : clients.length,
        endpoint: result.endpoint,
      },
    })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
