import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { getFlujoClient } from "@/server/flujotv/service"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { createCouponOrder } from "@/server/mercadopago/service"
import { licensePriceMxnOrNull } from "@/server/mercadopago/config"
import { AppError } from "@/server/umejson/types"
import { errorResponse, readJsonBody } from "@/server/http"
import { isRenewalMonths } from "@/lib/flujotv"

interface CouponOrderBody {
  user_name?: unknown
  months?: unknown
  code?: unknown
  request_id?: unknown
}

/**
 * Renovación pagada con cupón: valida el código contra los cupones activos
 * (por ahora solo 0000, compra directa sin validaciones), crea la orden ya
 * pagada y renueva la licencia al instante. El guard de alcance es idéntico
 * al de Mercado Pago: el distribuidor solo compra para sus clientes.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (licensePriceMxnOrNull() === null) {
      throw new AppError(
        503,
        "not_configured",
        "El precio de la licencia no está configurado en el servidor."
      )
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as CouponOrderBody
    const userName =
      typeof body.user_name === "string" ? body.user_name.trim() : ""
    if (userName.length === 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el nombre de usuario de la licencia.",
          },
        },
        { status: 422 }
      )
    }

    if (!isRenewalMonths(body.months)) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Los meses deben ser 1, 3, 6 o 12.",
          },
        },
        { status: 422 }
      )
    }

    const code = typeof body.code === "string" ? body.code.trim() : ""
    if (code.length === 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el código del cupón.",
          },
        },
        { status: 422 }
      )
    }

    // Identificador de la intención de canje generado por el cliente: hace
    // el canje idempotente (un reintento devuelve la orden original en lugar
    // de sumar otro mes).
    const requestId =
      typeof body.request_id === "string" ? body.request_id.trim() : ""
    if (requestId.length < 8 || requestId.length > 100) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el identificador de la solicitud del canje.",
          },
        },
        { status: 422 }
      )
    }

    // El perfil distribuidor solo puede comprar renovaciones de clientes de
    // su reseller ligado, igual que en los otros métodos de pago.
    const scope = await resolveClientScope(user)
    if (scope.kind === "none") {
      return Response.json(
        {
          ok: false,
          error: {
            code: "forbidden",
            message:
              "Tu cuenta no tiene un distribuidor ligado: no puedes comprar renovaciones.",
          },
        },
        { status: 403 }
      )
    }
    if (scope.kind === "distributor") {
      // La guarda de alcance no debe tirar la compra por lentitud del panel:
      // usa el presupuesto de compras en lugar del timeout de lectura.
      const target = await getFlujoClient(userName, {
        timeoutMs: FLUJO_PURCHASE_TIMEOUT_MS,
      })
      const allowed = target
        ? await isFlujoClientInScope(target, scope)
        : false
      if (!allowed) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "forbidden",
              message: `El cliente '${userName}' no pertenece a tu distribuidor.`,
            },
          },
          { status: 403 }
        )
      }
    }

    const result = await createCouponOrder({
      userName,
      months: body.months,
      buyerUserId: user.id,
      code,
      requestId,
    })

    return Response.json({
      ok: true,
      data: {
        order_id: result.orderId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        error: result.error,
        verified_expires_at: result.verifiedExpiresAt,
      },
    })
  } catch (error) {
    // Validaciones y estado del servidor (AppError) con su estado HTTP; los
    // errores del panel FlujoTV y de Mercado Pago con cada envoltorio.
    if (error instanceof AppError) return errorResponse(error)
    if (error instanceof Error && error.name === "FlujoApiError") {
      return flujoErrorResponse(error)
    }
    return mpErrorResponse(error)
  }
}
