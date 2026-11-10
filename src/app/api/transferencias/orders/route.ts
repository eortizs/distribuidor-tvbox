import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { getFlujoClient } from "@/server/flujotv/service"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import {
  createTransferOrder,
  listPendingTransferOrders,
} from "@/server/mercadopago/service"
import { licensePriceMxnOrNull } from "@/server/mercadopago/config"
import {
  deleteUserFile,
  maxUploadBytes,
  saveUserFile,
} from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"
import { errorResponse } from "@/server/http"
import { reviewTransferReceipt, checkRateLimitReceiptScan } from "@/server/transferencias/scan"
import { getActiveTransferConcept } from "@/server/transferencias/concepto"
import { isRenewalMonths } from "@/lib/flujotv"

/** Tipos de comprobante admitidos: foto o PDF del ticket de transferencia. */
const TICKET_MIME_PREFIXES = ["image/"]
const TICKET_MIME_EXACT = ["application/pdf"]

/** Código de 4 caracteres alfanuméricos (concepto de pago de la orden). */
const CONCEPTO_RE = /^[A-Za-z0-9]{4}$/

function isTicketMime(mimeType: string): boolean {
  return (
    TICKET_MIME_EXACT.includes(mimeType) ||
    TICKET_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  )
}

/**
 * Crea una orden de renovación pagada por transferencia bancaria: guarda el
 * ticket (multipart/form-data con `user_name`, `months`, `concepto` y `file`)
 * y la revisa automáticamente con el LLM configurado (`RECEIPT_SCAN_MODEL`):
 * fecha dentro del mes actual, concepto impreso con el código de pago de 4
 * caracteres entregado al comprador (paso 1 del flujo) y con el usuario de
 * FlujoTV, importe de la orden y beneficiario receptor. Si todo pasa, la
 * orden se aprueba y la renovación se lanza sola (respuesta
 * `review: "auto_approved"`); si algo no coincide, la orden queda `pending`
 * para la revisión manual del admin y el comprador recibe el aviso de
 * contactarlo (`review: "auto_rejected"`); sin modelo configurado o con el
 * escaneo caído, queda el flujo de siempre (`review: "manual"`). La
 * renovación NUNCA ocurre por subir el ticket sin verificación previa.
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
    if (!isRenewalMonths(months)) {
      throw new AppError(
        422,
        "validation_error",
        "Los meses deben ser 1, 3, 6 o 12."
      )
    }

    // Concepto de pago (paso 1 del flujo): el código entregado al comprador
    // debe existir, estar activo, ser del mes actual y corresponder a su
    // cuenta y al usuario renovado. Un código ajeno, vencido o ya anulado
    // (transferencia aprobada o rechazada) se rechaza en la puerta.
    const conceptoRaw = formData.get("concepto")
    const concepto =
      typeof conceptoRaw === "string" ? conceptoRaw.trim().toUpperCase() : ""
    if (!CONCEPTO_RE.test(concepto)) {
      throw new AppError(
        422,
        "validation_error",
        "Falta el concepto de pago: primero obtén el código del paso 1 de la transferencia."
      )
    }
    const concept = await getActiveTransferConcept({
      buyerUserId: user.id,
      userName,
      code: concepto,
    })
    if (!concept) {
      throw new AppError(
        422,
        "concepto_invalido",
        "El concepto de pago no es válido, expiró o ya fue usado. Regresa al paso 1 para obtener el vigente."
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

    const ticketBytes = new Uint8Array(await file.arrayBuffer())
    const saved = await saveUserFile({
      userId: user.id,
      kind: "attachment",
      fileName: file.name,
      mimeType: file.type,
      bytes: ticketBytes,
    })
    savedFileId = saved.id

    const result = await createTransferOrder({
      userName,
      months,
      buyerUserId: user.id,
      ticketFileId: saved.id,
      conceptId: concept.id,
      conceptCode: concept.code,
    })

    // Revisión automática del comprobante (LLM + condiciones de la orden):
    // nunca lanza; `manual` significa revisión admin como siempre. El cupón
    // de escaneos por comprador agotado también degrada a manual (sin error
    // para el comprador y sin llamadas de visión ilimitadas).
    let review
    if (checkRateLimitReceiptScan(user.id)) {
      review = await reviewTransferReceipt({
        orderId: result.orderId,
        buyerUserId: user.id,
        bytes: ticketBytes,
        mimeType: file.type,
        userName,
        amountMxn: result.amount,
        conceptCode: concept.code,
      })
    } else {
      review = { review: "manual" as const, status: "pending" as const, scan: null }
      console.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "mercadopago.transfer_scan_rate_limited",
          actor: `user:${user.username}`,
          order_id: result.orderId,
        })
      )
    }

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "mercadopago.transfer_created",
        actor: `user:${user.username}`,
        order_id: result.orderId,
        user_name: userName,
        months,
        amount: result.amount,
        ticket_file_id: saved.id,
        review: review.review,
      })
    )

    return Response.json(
      {
        ok: true,
        data: {
          order_id: result.orderId,
          amount: result.amount,
          currency: result.currency,
          review: review.review,
          status: review.status,
          // Motivos del rechazo automático (vacío salvo `auto_rejected`):
          // el comprador los muestra junto al aviso de contactar al admin.
          reasons: review.scan?.reasons ?? [],
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

/** Transferencias pendientes de revisión (solo admin). */
export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()
    if (user.role !== "admin") {
      return Response.json(
        {
          ok: false,
          error: {
            code: "forbidden",
            message: "Solo un administrador puede revisar transferencias.",
          },
        },
        { status: 403 }
      )
    }

    const orders = await listPendingTransferOrders()
    return Response.json({ ok: true, data: { orders } })
  } catch (error) {
    return mpErrorResponse(error)
  }
}
