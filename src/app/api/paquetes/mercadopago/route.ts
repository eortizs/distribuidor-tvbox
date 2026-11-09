import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { getFlujoClient } from "@/server/flujotv/service"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { createPaymentOrder } from "@/server/mercadopago/service"
import { readJsonBody } from "@/server/http"
import {
  isPaqueteMonths,
  paqueteBonusMonths,
  paqueteLabel,
} from "@/lib/paquetes"

interface PaqueteOrderBody {
  user_name?: unknown
  months?: unknown
}

/**
 * Crea la orden de pago y la preferencia de Mercado Pago para un paquete del
 * módulo «Paquetes FlujoTV» (3, 6 o 12 meses, con sus meses gratis). Es la
 * contraparte de `POST /api/mercadopago/orders` para paquetes: mismo flujo de
 * checkout (`purpose: wallet_purchase`), misma verificación por webhook y
 * mismo guard de alcance (el distribuidor solo compra para sus clientes),
 * con el retorno del checkout de vuelta al módulo.
 *
 * La renovación NO ocurre aquí: solo tras el pago aprobado, vía webhook.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as PaqueteOrderBody
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

    if (!isPaqueteMonths(body.months)) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Los meses del paquete deben ser 3, 6 o 12.",
          },
        },
        { status: 422 }
      )
    }

    // El perfil distribuidor solo puede comprar renovaciones de clientes de
    // su reseller ligado, igual que en la compra de licencias individuales.
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

    const result = await createPaymentOrder({
      userName,
      months: body.months,
      buyerUserId: user.id,
      buyerUsername: user.username,
      bonusMonths: paqueteBonusMonths(body.months),
      returnPath: "/modulos/paquetes-flujotv",
    })

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "paquetes.order_created",
        actor: `user:${user.username}`,
        order_id: result.orderId,
        user_name: userName,
        paquete: paqueteLabel(body.months),
        amount: result.amount,
      })
    )

    return Response.json({
      ok: true,
      data: {
        order_id: result.orderId,
        init_point: result.initPoint,
        amount: result.amount,
        currency: result.currency,
      },
    })
  } catch (error) {
    // Errores del panel FlujoTV (verificación de alcance) y de Mercado Pago
    // responden cada uno con su envoltorio.
    if (error instanceof Error && error.name === "FlujoApiError") {
      return flujoErrorResponse(error)
    }
    return mpErrorResponse(error)
  }
}
