import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { getFlujoClient } from "@/server/flujotv/service"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { createTransferOrder } from "@/server/mercadopago/service"
import { licensePriceMxnOrNull } from "@/server/mercadopago/config"
import {
  deleteUserFile,
  maxUploadBytes,
  saveUserFile,
} from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"
import { errorResponse } from "@/server/http"
import {
  isPaqueteMonths,
  paqueteBonusMonths,
  paqueteLabel,
} from "@/lib/paquetes"

/** Tipos de comprobante admitidos: foto o PDF del ticket de transferencia. */
const TICKET_MIME_PREFIXES = ["image/"]
const TICKET_MIME_EXACT = ["application/pdf"]

function isTicketMime(mimeType: string): boolean {
  return (
    TICKET_MIME_EXACT.includes(mimeType) ||
    TICKET_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  )
}

/**
 * Crea una orden de paquete pagada por transferencia bancaria (módulo
 * «Paquetes FlujoTV»): guarda el ticket (multipart/form-data con
 * `user_name`, `months` y `file`) y deja la orden `pending` para la revisión
 * del admin. La revisión es la misma de las renovaciones individuales
 * (`/clientes`, sección de transferencias) y al aprobarla la renovación
 * aplica el paquete completo con sus meses gratis.
 *
 * El guard de alcance es idéntico al de Mercado Pago: el distribuidor solo
 * puede comprar renovaciones de clientes de su reseller ligado.
 */
export async function POST(request: Request) {
  let savedFileId: string | null = null
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

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      throw new AppError(
        422,
        "invalid_request",
        "Se esperaba multipart/form-data con user_name, months y file."
      )
    }

    const userNameRaw = formData.get("user_name")
    const userName =
      typeof userNameRaw === "string" ? userNameRaw.trim() : ""
    if (userName.length === 0) {
      throw new AppError(
        422,
        "validation_error",
        "Falta el nombre de usuario de la licencia."
      )
    }

    const monthsRaw = formData.get("months")
    const months = Number(typeof monthsRaw === "string" ? monthsRaw : "")
    if (!isPaqueteMonths(months)) {
      throw new AppError(
        422,
        "validation_error",
        "Los meses del paquete deben ser 3, 6 o 12."
      )
    }

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
      // usa el presupuesto de compras en lugar del timeout de lectura, igual
      // que en las rutas de Mercado Pago y cupones.
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

    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(
        422,
        "validation_error",
        "Adjunta el ticket o comprobante de la transferencia."
      )
    }
    const maxBytes = maxUploadBytes()
    if (file.size > maxBytes) {
      throw new AppError(
        413,
        "file_too_large",
        `El ticket excede el límite de ${maxBytes} bytes.`
      )
    }
    if (!isTicketMime(file.type)) {
      throw new AppError(
        422,
        "invalid_file_type",
        "El ticket debe ser una imagen o un PDF."
      )
    }

    const saved = await saveUserFile({
      userId: user.id,
      kind: "attachment",
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    savedFileId = saved.id

    const result = await createTransferOrder({
      userName,
      months,
      buyerUserId: user.id,
      ticketFileId: saved.id,
      bonusMonths: paqueteBonusMonths(months),
    })

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "paquetes.transfer_created",
        actor: `user:${user.username}`,
        order_id: result.orderId,
        user_name: userName,
        paquete: paqueteLabel(months),
        amount: result.amount,
        ticket_file_id: saved.id,
      })
    )

    return Response.json(
      {
        ok: true,
        data: {
          order_id: result.orderId,
          amount: result.amount,
          currency: result.currency,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    // Sin orden no hay ticket que guardar: se elimina el archivo huérfano.
    if (savedFileId) {
      const userId = (await requireApiUser())?.id
      if (userId) await deleteUserFile(userId, savedFileId).catch(() => {})
    }
    if (error instanceof AppError) return errorResponse(error)
    if (error instanceof Error && error.name === "FlujoApiError") {
      return flujoErrorResponse(error)
    }
    return mpErrorResponse(error)
  }
}
