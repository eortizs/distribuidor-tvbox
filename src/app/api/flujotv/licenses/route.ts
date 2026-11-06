import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { getFlujoLicenses } from "@/server/flujotv/service"
import {
  resolveClientScope,
  scopeFlujoLicenses,
} from "@/server/flujotv/scope"

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const scope = await resolveClientScope(user)
    const result = await getFlujoLicenses()
    const licenses = await scopeFlujoLicenses(result.licenses, scope)
    return Response.json({
      ok: true,
      data: { licenses, endpoint: result.endpoint },
    })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
