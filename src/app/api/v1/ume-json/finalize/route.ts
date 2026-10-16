import {
  actorFor,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  finalizeDocument,
  validateDocument,
  validateSentinels,
} from "@/server/umejson/schema"
import { createEntity } from "@/server/umejson/repository"
import { type UmeJson } from "@/server/umejson/types"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response
    const input = parsed.body

    if (
      input &&
      typeof input === "object" &&
      "__diagnostic" in input &&
      (input as Record<string, unknown>).__diagnostic
    ) {
      return Response.json(
        {
          ok: false,
          source: "umejson_skill",
          error: {
            code: "umejson_diagnostic",
            message: "The umeJSON agent rejected the input",
          },
          diagnostic: (input as Record<string, unknown>).__diagnostic,
        },
        { status: 422 }
      )
    }

    const validation = validateDocument(input)
    if (!validation.valid) {
      return Response.json(
        {
          ok: false,
          source: "umejson_api",
          error: {
            code: "schema_violation",
            message: "Entity does not comply with the umeJSON schema",
            details: validation.errors,
          },
        },
        { status: 422 }
      )
    }

    const doc = input as UmeJson
    const sentinelErrors = validateSentinels(doc)
    if (sentinelErrors.length > 0) {
      return Response.json(
        {
          ok: false,
          source: "umejson_api",
          error: {
            code: "sentinel_violation",
            message:
              "Reserved fields must carry the RESERVED_FOR_SYSTEM sentinel or null",
            details: sentinelErrors,
          },
        },
        { status: 422 }
      )
    }

    if (user.role === "distribuidor") {
      doc.dynamicProperties = {
        ...doc.dynamicProperties,
        distribuidorId: user.id,
      }
    }

    const entity = finalizeDocument(doc)

    await createEntity(entity, {
      actor: actorFor(user),
      source: "finalize",
    })

    return Response.json({ ok: true, data: entity }, { status: 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
