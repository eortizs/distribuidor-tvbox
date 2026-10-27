import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { listFlujoResellers } from "@/server/flujotv/service"

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const result = await listFlujoResellers()

    return Response.json({
      ok: true,
      data: {
        resellers: result.resellers,
        totalResellers: result.totalResellers,
        clientsWithoutDistributor: result.clientsWithoutDistributor,
        fromCache: result.fromCache,
        cacheAge: result.cacheAge,
        searchTerm: result.searchTerm,
        endpoint: result.endpoint,
      },
    })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
