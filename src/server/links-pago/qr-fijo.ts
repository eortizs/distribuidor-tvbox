import { createHash } from "node:crypto"

import { currentTenantContext } from "@/server/tenant/context"
import { findUserById } from "@/server/auth/users"
import { AppError } from "@/server/umejson/types"
import { saveUserFile } from "@/server/storage/user-files"
import {
  extraerComprobanteDeArchivo,
  receiptScanConfigured,
  type ExtraccionLLM,
} from "@/server/transferencias/scan"
import {
  cobradorDelQr,
  conceptoLibreDeComprobante,
  leerImporteDeComprobante,
  parseCobradorQrRequest,
  PAYMENT_ORDER_MAX_MXN,
  PAYMENT_ORDER_MIN_MXN,
  paymentQrOrderStart,
  QR_MAX_ACTIVE_PER_PAYER,
} from "@/lib/links-pago"

import { resolveCreatorBankData, type PaymentOrderBank } from "./bank"
import {
  instruccionesQrPagoLibre,
  money,
  textoEstadoResuelto,
  type PaymentOrderTurnResult,
} from "./payment-order-messages"
import {
  createPaymentOrder,
  findPaymentOrderByTicketSha,
  findPaymentQrOwner,
  listActiveQrOrdersForPayer,
  listOpenPaymentQrRequestsForPayer,
  upsertPaymentQrRequest,
  type PaymentOrder,
} from "./repository"
import {
  checkPaymentOrderScanQuota,
  reviewPaymentReceipt,
  type PaymentReviewOutcome,
} from "./review"

/*
 * QR FIJO de cobro — PAGO LIBRE. El cobrador imprime un QR permanente
 * (spei.link/cobro/<CÓDIGO>, ver src/app/short/cobro) que abre el chat con
 * «Solicito realizar un pago. (cobrador XXXXXX)»: un mismo número de WhatsApp
 * atiende a todos los cobradores del panel, así que el código del mensaje es
 * lo que dice de quién es el QR (y a qué cuenta va el dinero).
 *
 * Dos turnos, sin preguntas:
 *   1. SOLICITUD → se identifica al pagador (su teléfono) y al cobrador; la
 *      solicitud queda en BD (`payment_qr_requests`, vigente 7 días y
 *      refrescada en cada escaneo — sobrevive a los deploys) y el pagador
 *      recibe las instrucciones con los datos de la cuenta + la CLABE sola.
 *      Transfiere el MONTO que quiera con el CONCEPTO que quiera.
 *   2. COMPROBANTE (foto/PDF) desde el MISMO WhatsApp → la orden nace de él:
 *      importe leído del comprobante, ligada a ese teléfono, a nombre del
 *      cobrador de su solicitud. Se valida el IMPORTE (no hay concepto que
 *      comparar) y la orden solo se confirma cuando el DEPÓSITO de ese
 *      importe acredita en la cuenta de Mercado Pago (review.ts +
 *      deposit-check.ts) — el comprobante declara, el depósito prueba.
 *
 * Guardas:
 *   - El MISMO archivo reenviado responde el estado de la orden que ya lo
 *     registró (huella sha256): no abre un segundo cobro.
 *   - Un número acumula como máximo `QR_MAX_ACTIVE_PER_PAYER` pagos de QR sin
 *     confirmar; el cobrador conserva su tope de 20 órdenes activas.
 *   - Sin solicitud vigente, o con varias en distintos cobradores sin un
 *     escaneo reciente que las desate, el comprobante NO se arriesga: se pide
 *     reescanear el QR y reenviarlo.
 *   - El inicio de la orden es CUANDO PAGÓ el pagador (hora impresa o último
 *     escaneo): es también el inicio de su ventana de depósito, así un
 *     comprobante VIEJO (de una transferencia anterior al escaneo) jamás
 *     confirma un cobro nuevo.
 */

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

/** Tenant del chat (el socket corre bajo el tenant de su sesión). */
function tenantKey(): string {
  return currentTenantContext()?.tenantId ?? ""
}

/* ------------------------------ textos ---------------------------------- */

/**
 * Guía para el comprobante de un número sin solicitud vigente: se le pide
 * reescanear el QR y reenviar el comprobante (lo usa también el canal de los
 * links con los números que alguna vez pagaron por un QR).
 */
export const TEXTO_QR_REESCANEAR =
  "No encuentro una solicitud de pago reciente desde este número. Escanea de nuevo el QR de quien te cobró, envía el mensaje que trae y después vuelve a enviar tu comprobante."

const TEXTO_AMBIGUO =
  "Tienes solicitudes de pago con más de un cobrador. Vuelve a escanear el QR de la persona a la que le pagaste y reenvía tu comprobante."

const TEXTO_TOPE_TELEFONO = `Ya tienes ${QR_MAX_ACTIVE_PER_PAYER} pagos de QR activos con este número. Espera a que se confirmen o contacta a quien te cobró antes de enviar otro comprobante.`

const TEXTO_CUPO =
  "Has enviado varios comprobantes en pocos segundos. Espera un minuto y vuelve a enviar el comprobante."

const TEXTO_SIN_VERIFICADOR =
  "No pude leer tu comprobante en este momento. Vuelve a enviar la foto en unos minutos; si el problema continúa, contacta a quien te cobró."

const TEXTO_NO_COMPROBANTE =
  "El archivo que enviaste no parece un comprobante de transferencia. Envía SOLO la foto o el PDF del comprobante de tu pago."

const TEXTO_IMPORTE_ILEGIBLE =
  "No pude leer el importe de tu comprobante. Envía de nuevo la foto (que se vea claro el monto) o contacta a quien te cobró."

const TEXTO_COBRADOR_SIN_CUENTA =
  "Este cobrador no puede recibir pagos por ahora. Contacta a quien te cobró para revisar el caso."

const TEXTO_LIMITE_COBRADOR =
  "Tu cobrador alcanzó su límite de pagos pendientes y por ahora no puede recibir más. Contacta a quien te cobró."

const TEXTO_ERROR =
  "No pude registrar tu pago en este momento. Vuelve a enviar el comprobante en unos minutos."

/* ------------------------- solicitud (texto) ----------------------------- */

/**
 * ¿El turno le pertenece al QR fijo? Es la ÚNICA definición: la usan el
 * gateway (para cederle el turno ANTES de la rama de clientes FlujoTV) y el
 * propio canal. Solo la frase de solicitud —no hay preguntas que contestar.
 */
export function claimsQrPaymentTurn(text: string): boolean {
  return parseCobradorQrRequest(text) !== null
}

/**
 * ¿Este teléfono tiene una solicitud de QR fijo vigente? Lo usa el gateway
 * con los ARCHIVOS: un comprobante enviado por un pagador del QR (también si
 * es cliente FlujoTV) va a la rama de pagos, no a la de renovaciones.
 */
export async function hasOpenQrRequest(phone: string): Promise<boolean> {
  const requests = await listOpenPaymentQrRequestsForPayer(phone).catch(
    () => []
  )
  return requests.length > 0
}

/**
 * Turno de SOLICITUD del QR fijo: identifica al cobrador del código, registra
 * al pagador y le entrega las instrucciones con los datos de la cuenta (más
 * la CLABE sola). Null = el turno no es del QR y sigue su curso.
 */
export async function maybeHandleQrPaymentText(input: {
  phone: string
  text: string
  payerName?: string | null
}): Promise<PaymentOrderTurnResult | null> {
  const text = input.text
  if (!claimsQrPaymentTurn(text)) return null

  const request = parseCobradorQrRequest(text)
  if (!request) return null
  if (request.code === null) {
    return {
      text: "Para pagar necesitas el código de cobro: escanea de nuevo el QR que te compartió tu cobrador y envía el mensaje que ya trae listo.",
      orderId: null,
      inboundText: text,
      mediaMime: null,
    }
  }

  const cobrador = await cobradorElegible(request.code, input.phone)
  if (!cobrador) {
    logEvent("orden_pago.qr_cobrador_invalido", {
      phone: maskPhone(input.phone),
      code: request.code,
    })
    return {
      text: "Este código de cobro no puede recibir pagos por ahora. Pide a tu cobrador que revise su QR fijo y te lo comparta de nuevo.",
      orderId: null,
      inboundText: text,
      mediaMime: null,
    }
  }

  const registered = await upsertPaymentQrRequest({
    payerPhone: input.phone,
    payerName: input.payerName ?? null,
    cobradorUserId: cobrador.userId,
  }).catch(() => null)
  if (!registered) {
    logEvent("orden_pago.qr_request_error", {
      phone: maskPhone(input.phone),
      cobrador: cobrador.userId,
    })
    return {
      text: "No pude registrar tu solicitud en este momento. Vuelve a enviar el mensaje en unos minutos.",
      orderId: null,
      inboundText: text,
      mediaMime: null,
    }
  }

  logEvent("orden_pago.qr_requested", {
    phone: maskPhone(input.phone),
    cobrador: cobrador.userId,
    code: request.code,
  })
  return {
    text: instruccionesQrPagoLibre(cobrador.bank),
    additionalTexts: [cobrador.bank.account],
    orderId: null,
    inboundText: text,
    mediaMime: null,
  }
}

/**
 * El cobrador del código puede recibir pagos HOY (tiene cuenta de cobro):
 * sus datos viajan en la primera respuesta. Null = código sin dueño o sin
 * cuenta (para el pagador es lo mismo: ese QR no puede cobrar ahora).
 */
async function cobradorElegible(
  code: string,
  phone: string
): Promise<{ userId: string; bank: PaymentOrderBank } | null> {
  const owner = await findPaymentQrOwner(code).catch(() => null)
  if (!owner) return null
  const bank = await resolveCreatorBankData({
    id: owner.id,
    username: owner.username,
    role: owner.role,
    tenantId: owner.tenantId,
  }).catch(() => null)
  if (!bank) {
    logEvent("orden_pago.qr_cobrador_sin_cuenta", {
      phone: maskPhone(phone),
      code,
    })
    return null
  }
  return { userId: owner.id, bank }
}

/* --------------------------- comprobante (archivo) ----------------------- */

export type QrReceiptOutcome =
  /** Respuesta directa (guías, estados y errores): el canal solo la envía. */
  | { kind: "reply"; text: string; orderId: string | null }
  /** La orden nació del comprobante y ya se revisó: el canal arma el veredicto. */
  | { kind: "review"; order: PaymentOrder; outcome: PaymentReviewOutcome }

/**
 * COMPROBANTE del pago libre del QR fijo. Lo llama el canal cuando el
 * teléfono es pagador de QR (tiene una solicitud vigente o ya pagó por uno).
 * Identifica al pagador por el teléfono, atribuye el cobro al cobrador de su
 * solicitud, crea la orden con el importe declarado en el comprobante y corre
 * la revisión de siempre (importe exacto → depósito en la cuenta). Nunca
 * lanza hacia el llamador: todo fallo es una respuesta.
 */
export async function atenderComprobanteQr(input: {
  phone: string
  payerName?: string | null
  text: string
  media: { mimeType: string; fileName: string | null; bytes: Uint8Array }
  /** Extracción ya corrida por el llamador (no se vuelve a gastar visión). */
  preextracted?: ExtraccionLLM
}): Promise<QrReceiptOutcome> {
  const sha256 = createHash("sha256").update(input.media.bytes).digest("hex")
  const answer = (text: string, orderId: string | null = null): QrReceiptOutcome => ({
    kind: "reply",
    text,
    orderId,
  })

  // El MISMO archivo ya registrado: se responde el estado de SU orden (un
  // reenvío del mismo comprobante jamás abre un segundo cobro).
  const known = await findPaymentOrderByTicketSha(sha256).catch(() => null)
  if (known) {
    logEvent("orden_pago.qr_receipt_reenvio", {
      phone: maskPhone(input.phone),
      order_id: known.id,
      status: known.status,
    })
    return answer(textoEstadoDelComprobante(known), known.id)
  }

  // ¿A quién le pagó este WhatsApp? Sus solicitudes vigentes.
  const requests = await listOpenPaymentQrRequestsForPayer(input.phone).catch(
    () => []
  )
  const quien = cobradorDelQr(
    requests.map((item) => ({
      cobradorUserId: item.cobradorUserId,
      lastRequestedAt: item.lastRequestedAt,
  }))
  )
  if (quien.kind === "sin_solicitud") return answer(TEXTO_QR_REESCANEAR)
  if (quien.kind === "ambiguo") return answer(TEXTO_AMBIGUO)
  const payerName =
    requests.find((item) => item.cobradorUserId === quien.cobradorUserId)
      ?.payerName ??
    input.payerName ??
    null

  const activas = await listActiveQrOrdersForPayer(input.phone).catch(() => [])
  if (activas.length >= QR_MAX_ACTIVE_PER_PAYER) {
    return answer(TEXTO_TOPE_TELEFONO)
  }

  if (!checkPaymentOrderScanQuota(input.phone)) return answer(TEXTO_CUPO)

  let extraccion = input.preextracted ?? null
  if (extraccion === null) {
    if (!receiptScanConfigured()) {
      logEvent("orden_pago.qr_receipt_sin_verificador", {
        phone: maskPhone(input.phone),
      })
      return answer(TEXTO_SIN_VERIFICADOR)
    }
    try {
      extraccion = await extraerComprobanteDeArchivo({
        bytes: input.media.bytes,
        mimeType: input.media.mimeType,
      })
    } catch (error) {
      logEvent("orden_pago.qr_receipt_scan_error", {
        phone: maskPhone(input.phone),
        error: error instanceof Error ? error.message : String(error),
      })
      return answer(TEXTO_SIN_VERIFICADOR)
    }
  }
  if (!extraccion.esComprobante || extraccion.datos === null) {
    return answer(TEXTO_NO_COMPROBANTE)
  }
  const amountMxn = leerImporteDeComprobante(extraccion.datos.importe)
  if (
    amountMxn === null ||
    amountMxn < PAYMENT_ORDER_MIN_MXN ||
    amountMxn > PAYMENT_ORDER_MAX_MXN
  ) {
    logEvent("orden_pago.qr_receipt_importe_ilegible", {
      phone: maskPhone(input.phone),
      importe: extraccion.datos.importe,
    })
    return answer(TEXTO_IMPORTE_ILEGIBLE)
  }

  // Cuenta de cobro del cobrador, al momento: de ahí salen el snapshot de la
  // orden y la credencial que verifica el depósito.
  const user = await findUserById(quien.cobradorUserId).catch(() => null)
  const bank =
    user &&
    (await resolveCreatorBankData({
      id: user.id,
      username: user.username,
      role: user.role,
      tenantId: tenantKey() || null,
    }).catch(() => null))
  if (!user || !bank) return answer(TEXTO_COBRADOR_SIN_CUENTA)

  // El comprobante se guarda bajo la cuenta del cobrador ANTES de crear la
  // orden: la revisión lo liga a ella (sin archivo no hay evidencia).
  let ticketFileId: string
  try {
    ticketFileId = (
      await saveUserFile({
        userId: user.id,
        kind: "attachment",
        fileName: input.media.fileName ?? "comprobante",
        mimeType: input.media.mimeType,
        bytes: input.media.bytes,
      })
    ).id
  } catch (error) {
    logEvent("orden_pago.qr_ticket_store_error", {
      phone: maskPhone(input.phone),
      error: error instanceof Error ? error.message : String(error),
    })
    return answer(TEXTO_ERROR)
  }

  let order: PaymentOrder
  try {
    order = await createPaymentOrder({
      creatorUserId: user.id,
      amountMxn,
      // Referencia informativa: el concepto es libre y nunca se valida.
      note: conceptoLibreDeComprobante(extraccion.datos.concepto),
      bank,
      origin: "qr",
      payer: { phone: input.phone, name: payerName },
      createdAt: paymentQrOrderStart({
        lastRequestedAt: quien.lastRequestedAt,
        receiptFecha: extraccion.datos.fecha,
        receiptHora: extraccion.datos.hora,
      }),
    })
  } catch (error) {
    if (error instanceof AppError && error.code === "payment_order_limit") {
      logEvent("orden_pago.qr_create_limite_cobrador", {
        phone: maskPhone(input.phone),
        cobrador: quien.cobradorUserId,
      })
      return answer(TEXTO_LIMITE_COBRADOR)
    }
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `links-pago: qr_create: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
    return answer(TEXTO_ERROR)
  }

  logEvent("orden_pago.qr_created", {
    phone: maskPhone(input.phone),
    order_id: order.id,
    code: order.code,
    cobrador: order.creatorUserId,
    amount: order.amountMxn,
  })

  const outcome = await reviewPaymentReceipt({
    order,
    bytes: input.media.bytes,
    mimeType: input.media.mimeType,
    ticketFileId,
    preextracted: extraccion,
  })
  return { kind: "review", order, outcome }
}

/** Estado real de la orden que ya registró este comprobante. */
function textoEstadoDelComprobante(order: PaymentOrder): string {
  if (order.status === "pending") {
    return `El comprobante que enviaste ya está registrado en la orden *${order.code}* (${money(
      order.amountMxn
    )}) y está pendiente: quien te cobró confirmará la recepción y te avisará por este chat. No es necesario volver a enviarlo.`
  }
  return textoEstadoResuelto(order)
}
