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
import {
  isPaqueteMonths,
  paqueteBonusMonths,
  PAQUETE_COUPON_CODE,
} from "@/lib/paquetes"

interface PaqueteCouponBody {
  user_name?: unknown
  months?: unknown
  request_id?: unknown
}

/**
 * Renovación por paquete pagada con cupón (módulo «Paquetes FlujoTV»): el
 * cupón asignado es `1010` para cualquiera de los paquetes (3, 6 o 12 meses)
 * y lo valida el servidor — el cliente solo envía el usuario, el paquete y
 * el identificador del canje. Crea la orden ya pagada y renueva la licencia
 * al instante con los meses gratis del paquete; el guard de alcance es
 * idéntico al de los otros métodos de pago.
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

    const body = parsed.body as PaqueteCouponBody
    const userName =
      typeof body.user_name === "string" ? body.user_name.trim() : ""
    if (userName.length === 0) {
      throw new AppError(
        422,
        "validation_error",
        "Falta el nombre de usuario de la licencia."
      )
    }

    if (!isPaqueteMonths(body.months)) {
      throw new AppError(
        422,
        "validation_error",
        "Los meses del paquete deben ser 3, 6 o 12."
      )
    }

    // Identificador de la intención de canje generado por el cliente: hace
    // el canje idempotente (un reintento devuelve la orden original en lugar
    // de sumar otro paquete).
    const requestId =
      typeof body.request_id === "string" ? body.request_id.trim() : ""
    if (requestId.length < 8 || requestId.length > 100) {
      throw new AppError(
        422,
        "validation_error",
        "Falta el identificador de la solicitud del canje."
      )
    }

    // El perfil distribuidor solo puede comprar renovaciones de clientes de
    // su reseller ligado, igual que en los otros métodos de pago.
    const scope = await resolveClientScope(user)
    if (scope.kind === "none") {
      throw new AppError(
        403,
        "forbidden",
        "Tu cuenta no tiene un distribuidor ligado: no puedes comprar renovaciones."
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
        throw new AppError(
          403,
          "forbidden",
          `El cliente '${userName}' no pertenece a tu distribuidor.`
        )
      }
    }

    const result = await createCouponOrder({
      userName,
      months: body.months,
      buyerUserId: user.id,
      code: PAQUETE_COUPON_CODE,
      requestId,
      bonusMonths: paqueteBonusMonths(body.months),
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
        months: result.months,
        bonus_months: result.bonusMonths,
        transaction_id: result.transactionId,
        replayed: result.replayed,
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
