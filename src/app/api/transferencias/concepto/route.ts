import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { AppError } from "@/server/umejson/types"
import { errorResponse } from "@/server/http"
import {
  checkRateLimitConceptIssuance,
  getOrCreateTransferConcept,
} from "@/server/transferencias/concepto"

/**
 * Entrega el concepto de pago de la transferencia bancaria: código de 4
 * caracteres alfanuméricos ligado al comprador y al usuario de FlujoTV que
 * se renueva, vigente durante el mes actual. Es el PASO 1 del flujo de dos
 * pasos: el comprador lo escribe en su transferencia y, solo después,
 * sube el comprobante (`POST /api/transferencias/orders` exige este código).
 *
 * Idempotente por diseño: si el comprador canceló y vuelve a elegir
 * transferencia en el mismo mes, recibe el MISMO código (latente). Los
 * códigos anulados (transferencia aprobada o rechazada) producen uno nuevo.
 *
 * Sin lectura del panel de licencias: la guarda de alcance de la compra ya
 * ocurre al crear la orden; aquí solo se emite el concepto, inútil fuera de
 * la cuenta del comprador.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = (await request.json().catch(() => null)) as {
      user_name?: unknown
    } | null
    const userName =
      typeof body?.user_name === "string" ? body.user_name.trim() : ""
    if (userName.length === 0) {
      throw new AppError(
        422,
        "validation_error",
        "Falta el nombre de usuario de la licencia."
      )
    }

    // Tope de emisiones por comprador: sin él, una cuenta podría acuñar el
    // namespace mensual de códigos (único global entre compradores).
    if (!checkRateLimitConceptIssuance(user.id)) {
      throw new AppError(
        429,
        "concepto_rate_limited",
        "Demasiadas peticiones de concepto de pago; espera unos segundos e inténtalo de nuevo."
      )
    }

    const concept = await getOrCreateTransferConcept({
      buyerUserId: user.id,
      userName,
    })

    return Response.json({
      ok: true,
      data: { code: concept.code, month: concept.periodMonth },
    })
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error)
    return Response.json(
      {
        ok: false,
        error: {
          code: "concepto_error",
          message: "No se pudo generar el concepto de pago.",
        },
      },
      { status: 500 }
    )
  }
}
