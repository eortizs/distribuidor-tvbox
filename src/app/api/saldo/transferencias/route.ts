import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { mpErrorResponse } from "@/server/mercadopago/errors"
import { createSaldoTransferOrder } from "@/server/mercadopago/saldo-orders"
import { AppError } from "@/server/umejson/types"
import { errorResponse } from "@/server/http"
import {
  deleteUserFile,
  maxUploadBytes,
  saveUserFile,
} from "@/server/storage/user-files"
import {
  reviewTransferReceipt,
  checkRateLimitReceiptScan,
} from "@/server/transferencias/scan"
import { getActiveTransferConcept } from "@/server/transferencias/concepto"
import { parseAbonoAmount, parseSaldoTipo } from "@/lib/saldo"

/** Tipos de comprobante admitidos: foto o PDF del ticket de transferencia. */
const TICKET_MIME_PREFIXES = ["image/"]
const TICKET_MIME_EXACT = ["application/pdf"]

/** Código de 4 caracteres alfanuméricos (concepto de pago del abono). */
const CONCEPTO_RE = /^[A-Za-z0-9]{4}$/

function isTicketMime(mimeType: string): boolean {
  return (
    TICKET_MIME_EXACT.includes(mimeType) ||
    TICKET_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  )
}

/**
 * Crea una orden de abono de saldo pagada por transferencia bancaria
 * (multipart/form-data con `amount`, `concepto` y `file`): guarda el ticket
 * y lo revisa automáticamente con el LLM configurado
 * (`RECEIPT_SCAN_MODEL`) — fecha del mes, concepto con el código de pago del
 * paso 1, importe y beneficiario. Todo pasa → la orden se aprueba y el
 * saldo se acredita solo; algo falla → queda `pending` para la revisión
 * manual del admin; sin modelo configurado → revisión manual como siempre.
 */
export async function POST(request: Request) {
  let savedFileId: string | null = null
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      throw new AppError(
        422,
        "invalid_request",
        "Se esperaba multipart/form-data con amount, concepto y file."
      )
    }

    const amountRaw = formData.get("amount")
    const amount =
      typeof amountRaw === "string" || typeof amountRaw === "number"
        ? amountRaw
        : ""
    const parsed = parseAbonoAmount(amount)
    if (!parsed.ok) {
      throw new AppError(422, "validation_error", parsed.message)
    }

    // Billetera destino del abono: tokens o cupones. Sin `tipo` (bundle
    // viejo en caché) el destino es cupones; un valor inválido se rechaza.
    const tipoRaw = formData.get("tipo")
    const saldoTipo =
      typeof tipoRaw === "string" && tipoRaw.length > 0
        ? parseSaldoTipo(tipoRaw)
        : "cupones"
    if (!saldoTipo) {
      throw new AppError(
        422,
        "validation_error",
        "El tipo de saldo debe ser tokens o cupones."
      )
    }

    // Concepto de pago (paso 1 del flujo): el código entregado al comprador
    // debe existir, estar activo, ser del mes actual y corresponder a su
    // cuenta (el abono se liga al propio username del comprador).
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
      userName: user.username,
      code: concepto,
    })
    if (!concept) {
      throw new AppError(
        422,
        "concepto_invalido",
        "El concepto de pago no es válido, expiró o ya fue usado. Regresa al paso 1 para obtener el vigente."
      )
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

    const result = await createSaldoTransferOrder({
      buyerUserId: user.id,
      buyerUsername: user.username,
      amountMxn: parsed.amount,
      saldoTipo,
      ticketFileId: saved.id,
      conceptId: concept.id,
      conceptCode: concept.code,
    })

    // Revisión automática del comprobante (LLM + condiciones de la orden):
    // nunca lanza; `manual` significa revisión admin como siempre. El tope
    // de escaneos por comprador agotado también degrada a manual.
    let review
    if (checkRateLimitReceiptScan(user.id)) {
      review = await reviewTransferReceipt({
        orderId: result.orderId,
        buyerUserId: user.id,
        bytes: ticketBytes,
        mimeType: file.type,
        userName: user.username,
        amountMxn: result.amount,
        conceptCode: concept.code,
      })
    } else {
      review = { review: "manual" as const, status: "pending" as const, scan: null }
      console.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "saldo.transfer_scan_rate_limited",
          actor: `user:${user.username}`,
          order_id: result.orderId,
        })
      )
    }

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "saldo.transfer_created",
        actor: `user:${user.username}`,
        order_id: result.orderId,
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
    return mpErrorResponse(error)
  }
}
