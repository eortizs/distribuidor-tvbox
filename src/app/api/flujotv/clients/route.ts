import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import {
  fetchFlujoClientNames,
  listFlujoClients,
} from "@/server/flujotv/service"
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

    // Nombres propios (columna Notas del panel vía /client_names) en
    // paralelo: si esa lectura falla, el listado carga igual sin nombres.
    const [result, names] = await Promise.all([
      listFlujoClients({
        query,
        limit,
        offset,
        includeCredentials,
        full,
      }),
      fetchFlujoClientNames().catch(() => null),
    ])

    // El perfil distribuidor solo recibe los clientes asignados a su
    // reseller ligado; el total reportado se ajusta al listado filtrado.
    const scope = await resolveClientScope(user)
    const clients = await scopeFlujoClients(result.clients, scope)

    // El mapa de nombres se acota a los clientes del alcance del perfil:
    // no expone nombres de clientes fuera de él.
    const scopedUsernames = new Set(
      clients.map((client) => client.userName.trim().toLowerCase())
    )
    const clientNames = names
      ? Object.fromEntries(
          Object.entries(names.clientNames).filter(([username]) =>
            scopedUsernames.has(username)
          )
        )
      : null

    return Response.json({
      ok: true,
      data: {
        clients,
        total: scope.kind === "all" ? result.total : clients.length,
        endpoint: result.endpoint,
        clientNames,
      },
    })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
