import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { getFlujoStatus } from "@/server/flujotv/service"

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const status = await getFlujoStatus()
    return Response.json({ ok: true, data: status })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
