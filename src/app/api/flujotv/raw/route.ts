import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { flujoRawRequest } from "@/server/flujotv/service"
import { readJsonBody } from "@/server/http"

interface RawBody {
  method?: unknown
  path?: unknown
  query?: unknown
  body?: unknown
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as RawBody
    const method = body.method === "POST" ? "POST" : "GET"
    const path = typeof body.path === "string" ? body.path.trim() : ""
    if (path.length === 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Indica la ruta del endpoint (por ejemplo /openapi.json).",
          },
        },
        { status: 422 }
      )
    }

    const result = await flujoRawRequest({
      method,
      path,
      query: typeof body.query === "string" ? body.query : "",
      body: typeof body.body === "string" ? body.body : "",
    })

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
