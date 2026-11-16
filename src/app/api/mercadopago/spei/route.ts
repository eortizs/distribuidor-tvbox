import {
  forbiddenResponse,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { cdmxToday, listSpeiDepositsForDay } from "@/server/mercadopago/spei"

/**
 * Reporte SPEI: depósitos por transferencia bancaria (CLABE) acreditados en
 * la cuenta de Mercado Pago del vendedor para el día indicado (CDMX). Solo
 * admin: la cuenta MP es única y sus depósitos son información del titular.
 *
 * `GET /api/mercadopago/spei?fecha=YYYY-MM-DD` (omisible → hoy en CDMX).
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()
    if (user.role !== "admin") return forbiddenResponse()

    const { searchParams } = new URL(request.url)
    const raw = searchParams.get("fecha")?.trim() ?? ""
    const day = raw.length > 0 ? raw : cdmxToday()

    const report = await listSpeiDepositsForDay(day)

    return Response.json({ ok: true, data: report })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
