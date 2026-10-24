import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { getFlujoLicenses } from "@/server/flujotv/service"

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const result = await getFlujoLicenses()
    return Response.json({
      ok: true,
      data: { licenses: result.licenses, endpoint: result.endpoint },
    })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
