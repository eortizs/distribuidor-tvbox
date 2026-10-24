import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { refreshFlujoCache } from "@/server/flujotv/service"
import { readJsonBody } from "@/server/http"

interface RefreshBody {
  target?: unknown
}

/**
 * Refresco real contra el panel de FlujoTV: dispara la sincronización de
 * clientes y tarda alrededor de 90 s. Solo se llama desde una acción
 * explícita en la interfaz.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as RefreshBody
    const target = body.target === "cache" ? "cache" : "list_clients"

    const result = await refreshFlujoCache(target)

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "flujotv.refresh",
        actor: `user:${user.username}`,
        target,
        status: result.status,
      })
    )

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
