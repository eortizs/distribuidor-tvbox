import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { listFlujoResellers } from "@/server/flujotv/service"
import {
  resolveClientScope,
  scopeFlujoResellers,
  scopeUserResellersMap,
} from "@/server/flujotv/scope"

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const scope = await resolveClientScope(user)
    const result = await listFlujoResellers()
    const resellers = scopeFlujoResellers(result.resellers, scope)

    return Response.json({
      ok: true,
      data: {
        resellers,
        totalResellers: scope.kind === "all" ? result.totalResellers : resellers.length,
        clientsWithoutDistributor:
          scope.kind === "all" ? result.clientsWithoutDistributor : null,
        userResellers: scopeUserResellersMap(result.userResellers, scope),
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
