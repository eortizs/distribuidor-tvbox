import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import type { AuthUser } from "@/server/auth/types"
import { getFlujoClient } from "@/server/flujotv/service"
import {
  assertFlujoPurchaseScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"
import { licensePriceMxnOrNull } from "@/server/mercadopago/config"
import {
  clientLicensePriceMxnOrNull,
  getClientMetadata,
  upsertClientMetadata,
} from "@/server/clientes/metadata"

interface MetadataBody extends Record<string, unknown> {
  usuario?: unknown
  alias?: unknown
  whatsapp_phone?: unknown
  price_mxn?: unknown
}

function readUserName(body: Record<string, unknown>): string {
  const value = typeof body.usuario === "string" ? body.usuario.trim() : ""
  if (value.length === 0) {
    throw new AppError(
      422,
      "validation_error",
      "Falta el nombre de usuario del cliente."
    )
  }
  return value
}

/** La guarda de alcance de las compras: el distribuidor solo toca a sus clientes. */
async function assertInScope(userName: string, user: AuthUser) {
  const scope = await resolveClientScope(user)
  if (scope.kind === "none") {
    throw new AppError(
      403,
      "forbidden",
      "Tu cuenta no tiene un distribuidor ligado: no puedes editar clientes."
    )
  }
  if (scope.kind === "distributor") {
    const target = await getFlujoClient(userName, {
      timeoutMs: FLUJO_PURCHASE_TIMEOUT_MS,
    })
    await assertFlujoPurchaseScope({ userName, target, scope })
  }
}

/**
 * Metadatos locales de un cliente de `/clientes` (alias, WhatsApp y precio
 * especial por cliente). GET devuelve la fila resuelta (con el precio
 * vigente: especial o general) y PUT la guarda completa.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const params = new URL(request.url).searchParams
    const userName = params.get("usuario")?.trim() ?? ""
    if (userName.length === 0) {
      throw new AppError(
        422,
        "validation_error",
        "Falta el nombre de usuario del cliente."
      )
    }

    await assertInScope(userName, user)
    const [metadata, resolvedPrice] = await Promise.all([
      getClientMetadata(userName),
      clientLicensePriceMxnOrNull(userName),
    ])

    return Response.json({
      ok: true,
      data: {
        usuario: userName.toLowerCase(),
        alias: metadata?.alias ?? null,
        whatsapp_phone: metadata?.whatsappPhone ?? null,
        price_mxn: metadata?.priceMxn ?? null,
        price_resolved_mxn: resolvedPrice,
        price_is_override: metadata?.priceMxn != null,
        price_default_mxn: licensePriceMxnOrNull(),
      },
    })
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error)
    return flujoErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const payload = body.body as MetadataBody
    const userName = readUserName(payload)

    // El precio especial cambia lo que se cobra por renovar a ese cliente:
    // solo el administrador puede fijarlo o quitarlo.
    if (payload.price_mxn !== undefined && user.role !== "admin") {
      throw new AppError(
        403,
        "forbidden",
        "Solo el administrador puede cambiar el precio de la licencia."
      )
    }

    await assertInScope(userName, user)
    const saved = await upsertClientMetadata({
      userName,
      userId: user.id,
      alias: payload.alias,
      whatsappPhone: payload.whatsapp_phone,
      priceMxn: user.role === "admin" ? payload.price_mxn : undefined,
    })
    const resolvedPrice = await clientLicensePriceMxnOrNull(userName)

    return Response.json({
      ok: true,
      data: {
        usuario: saved.userName,
        alias: saved.alias,
        whatsapp_phone: saved.whatsappPhone,
        price_mxn: saved.priceMxn,
        price_resolved_mxn: resolvedPrice,
        price_is_override: saved.priceMxn != null,
        price_default_mxn: licensePriceMxnOrNull(),
      },
    })
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error)
    if (error instanceof Error && error.name === "FlujoApiError") {
      return flujoErrorResponse(error)
    }
    return errorResponse(error)
  }
}
