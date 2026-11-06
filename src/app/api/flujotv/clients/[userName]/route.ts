import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { getFlujoClient } from "@/server/flujotv/service"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"

type RouteContext = { params: Promise<{ userName: string }> }

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { userName } = await ctx.params
    const decoded = decodeURIComponent(userName).trim()
    if (decoded.length === 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el nombre de usuario.",
          },
        },
        { status: 422 }
      )
    }

    const params = new URL(request.url).searchParams
    const client = await getFlujoClient(decoded, {
      includeCredentials: params.get("include_credentials") === "true",
      full: params.get("full") === "true",
    })

    // El distribuidor no puede leer clientes de otro reseller: fuera de
    // alcance responde igual que un cliente inexistente, sin revelar si existe.
    const scope = await resolveClientScope(user)
    if (client && !(await isFlujoClientInScope(client, scope))) {
      return Response.json({ ok: true, data: { client: null } })
    }

    return Response.json({ ok: true, data: { client } })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
