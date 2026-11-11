import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { createSaldoPaymentOrder } from "@/server/mercadopago/saldo-orders"
import { readJsonBody } from "@/server/http"
import { parseSaldoTipo } from "@/lib/saldo"

interface SaldoOrderBody {
  amount?: unknown
  /** Billetera destino del abono: tokens o cupones. */
  tipo?: unknown
}

/**
 * Crea la orden de abono de saldo y la preferencia de Mercado Pago
 * (`purpose: wallet_purchase`) del módulo «Abonar saldo». El comprador
 * define el monto y el tipo de saldo (tokens o cupones); el cargo se engrosa
 * con la comisión del procesador para que el depósito neto acredite
 * exactamente ese monto. Devuelve el `init_point`: el navegador redirige ahí
 * para pagar y el webhook acredita la billetera cuando el pago llega
 * aprobado y verificado.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as SaldoOrderBody
    if (body.amount === undefined) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el monto a abonar.",
          },
        },
        { status: 422 }
      )
    }

    // Sin `tipo` (bundle viejo en caché) el destino es cupones: la billetera
    // que siempre existió; un tipo inválido explícito se rechaza.
    const saldoTipo = body.tipo === undefined ? "cupones" : parseSaldoTipo(body.tipo)
    if (!saldoTipo) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "El tipo de saldo debe ser tokens o cupones.",
          },
        },
        { status: 422 }
      )
    }

    const result = await createSaldoPaymentOrder({
      buyerUserId: user.id,
      buyerUsername: user.username,
      amountMxn: body.amount,
      saldoTipo,
    })

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "saldo.order_created",
        actor: `user:${user.username}`,
        order_id: result.orderId,
        credit_amount: result.creditAmount,
        amount: result.amount,
        saldo_tipo: saldoTipo,
      })
    )

    return Response.json({
      ok: true,
      data: {
        order_id: result.orderId,
        init_point: result.initPoint,
        amount: result.amount,
        credit_amount: result.creditAmount,
        currency: result.currency,
      },
    })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
