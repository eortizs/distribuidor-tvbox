import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  changeState,
  getEntity,
  updateProperties,
} from "@/server/umejson/repository"
import { AppError } from "@/server/umejson/types"

type RouteContext = { params: Promise<{ id: string }> }

function scopeFor(
  user: NonNullable<Awaited<ReturnType<typeof requireApiUser>>>
) {
  return user.role === "distribuidor"
    ? { ownedByDistribuidorId: user.id }
    : undefined
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const entity = await getEntity(id, scopeFor(user))
    return Response.json({ ok: true, data: entity })
  } catch (error) {
    return errorResponse(error)
  }
}

interface PatchBody {
  version?: number
  dynamicProperties?: Record<string, unknown>
  state?: string
  reason?: string
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { id } = await ctx.params
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as PatchBody
    if (
      typeof body.version !== "number" ||
      !Number.isInteger(body.version) ||
      body.version < 1
    ) {
      throw new AppError(
        422,
        "validation_error",
        "body.version (integer >= 1) is required for optimistic locking"
      )
    }

    const hasProperties =
      body.dynamicProperties !== undefined &&
      body.dynamicProperties !== null
    const hasState = body.state !== undefined && body.state !== null

    if (hasProperties === hasState) {
      throw new AppError(
        422,
        "validation_error",
        "Provide exactly one of dynamicProperties or state"
      )
    }

    const actor = `user:${user.username}`
    const ownership = { ownedByDistribuidorId: user.id }

    let entity
    if (hasProperties && body.dynamicProperties) {
      entity = await updateProperties(
        id,
        body.version,
        body.dynamicProperties,
        { actor, reason: body.reason, ...ownership }
      )
    } else {
      entity = await changeState(id, body.version, body.state as string, {
        actor,
        reason: body.reason,
        ...ownership,
      })
    }

    return Response.json({ ok: true, data: entity })
  } catch (error) {
    return errorResponse(error)
  }
}
