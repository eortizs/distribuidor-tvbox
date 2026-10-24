import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { listFlujoClients } from "@/server/flujotv/service"

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

    return Response.json({
      ok: true,
      data: {
        clients: result.clients,
        total: result.total,
        endpoint: result.endpoint,
      },
    })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
