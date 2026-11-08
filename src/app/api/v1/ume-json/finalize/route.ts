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
import { ACCOUNT_ENTITY_NAME } from "@/server/auth/types"
import { ENTITY_NAME_TICKET } from "@/lib/tickets"

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

    // La entidad Cuenta es la única fuente de verdad del vínculo usuario ↔
    // reseller que muestra el panel admin: solo el flujo interno de cuentas
    // (createAccount) puede crearla, nunca un cliente de la API.
    if (user.role !== "admin" && doc.entityName === ACCOUNT_ENTITY_NAME) {
      return Response.json(
        {
          ok: false,
          source: "umejson_api",
          error: {
            code: "reserved_entity_name",
            message: "Entity name 'Cuenta' is reserved for account management",
          },
        },
        { status: 403 }
      )
    }
    // TicketCompra solo se crea por el módulo Alta de tickets: garantiza la
    // foto privada, la fila de control y la idempotencia del análisis.
    if (doc.entityName === ENTITY_NAME_TICKET) {
      return Response.json(
        {
          ok: false,
          source: "umejson_api",
          error: {
            code: "reserved_entity_name",
            message: "Entity name 'TicketCompra' is reserved for the tickets module",
          },
        },
        { status: 403 }
      )
    }

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
