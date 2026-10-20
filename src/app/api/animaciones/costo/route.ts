import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { getAnimationSessionCost } from "@/server/animaciones/service"
import { errorResponse } from "@/server/http"

/** Costo en vivo del tarificador para una conversación del agente. */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const sessionId = (searchParams.get("sessionId") ?? "").trim()
    if (!sessionId) {
      return Response.json(
        {
          ok: false,
          error: { code: "invalid_request", message: "Falta sessionId" },
        },
        { status: 400 }
      )
    }

    const data = await getAnimationSessionCost(user.id, sessionId)
    return Response.json({ ok: true, data })
  } catch (error) {
    return errorResponse(error)
  }
}
