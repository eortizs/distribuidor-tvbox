import {
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { cdmxToday, listSpeiDepositsForDay } from "@/server/mercadopago/spei"
import { getOwnMpAccessToken } from "@/server/mercadopago/tokens"
import { AppError } from "@/server/umejson/types"

/**
 * Reporte SPEI: depósitos por transferencia bancaria (CLABE) acreditados en
 * la cuenta de Mercado Pago que consulta el llamador:
 *
 *   - ADMIN → cuenta de plataforma (`MERCADOPAGO_ACCESS_TOKEN`), el
 *     comportamiento histórico (503 si el servidor no la tiene configurada).
 *   - DISTRIBUIDOR → SU credencial propia (Perfil → Datos bancarios); sin
 *     token registrado responde 403 con la indicación. La columna «Concepto»
 *     de su reporte solo casa con conceptos emitidos por su cuenta.
 *
 * `GET /api/mercadopago/spei?fecha=YYYY-MM-DD` (omisible → hoy en CDMX).
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    let accessToken: string | undefined
    let conceptBuyerUserId: string | undefined
    if (user.role === "admin") {
      // Cuenta de plataforma: `undefined` → `mercadoPagoGatewayRequest` (503
      // con el mensaje de configuración si falta el token del `.env`).
      accessToken = undefined
    } else {
      const own = await getOwnMpAccessToken(user.id).catch(() => null)
      if (!own) {
        throw new AppError(
          403,
          "mp_token_missing",
          "No tienes un token de Mercado Pago registrado. Regístralo en Perfil → Datos bancarios para consultar los depósitos de tu cuenta."
        )
      }
      accessToken = own
      conceptBuyerUserId = user.id
    }

    const { searchParams } = new URL(request.url)
    const raw = searchParams.get("fecha")?.trim() ?? ""
    const day = raw.length > 0 ? raw : cdmxToday()

    const report = await listSpeiDepositsForDay(day, accessToken, {
      conceptBuyerUserId,
    })

    return Response.json({ ok: true, data: report })
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error)
    return mpErrorResponse(error)
  }
}
