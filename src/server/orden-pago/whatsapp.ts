import { createHash } from "node:crypto"

import { isTransferConceptCodeShape } from "@/server/transferencias/concepto"
import { conceptoImpresoCoincide } from "@/server/asistente/renovacion"
import {
  extraerComprobanteDeArchivo,
  receiptScanConfigured,
  type ExtraccionLLM,
  type ScanResult,
} from "@/server/transferencias/scan"
import { saveUserFile } from "@/server/storage/user-files"

import {
  findPendingPaymentOrderByAnyCode,
  findResolvedPaymentOrderByAnyCode,
  listPendingPaymentOrders,
  savePaymentOrderScan,
  touchPaymentOrderPayer,
  type PaymentOrder,
} from "./repository"
import {
  checkPaymentOrderScanQuota,
  notifyPaymentOrderCreator,
  reviewPaymentReceipt,
} from "./review"

/*
 * Canal WhatsApp del PAGADOR de una orden de pago: cualquier persona sin
 * cuenta en el panel. El socket (rama de números no registrados ni clientes)
 * llama a estos handlers; ambos devuelven null cuando el turno NO es de una
 * orden de pago y el flujo debe seguir (cortesía de número desconocido).
 *
 *   - Texto (la liga wa.me llega con el texto prellenado): se buscan tokens
 *     con forma de código que matcheen una orden PENDIENTE → instrucciones
 *     completas (importe, banco, cuenta, titular, código como concepto).
 *   - Comprobante (foto/PDF solo o con caption): el CÓDIGO IMPRESO en el
 *     comprobante descubre la orden entre las pendientes (mismo criterio de
 *     match que distribuidor y clientes); sin impresión legible manda el
 *     código del caption, y sin ambos, el teléfono de un pagador ya
 *     conocido. El escaneo valida (fecha, código, importe, beneficiario) y
 *     responde el veredicto; sin verificador, el archivo queda ligado a la
 *     orden para revisión manual del creador — el comprobante nunca se
 *     pierde.
 *
 * Guardas anti-fraude del binding: un mensaje grande no sondea la tabla
 * token a token (tope de tokens + UNA consulta ANY), y una orden cuyo código
 * fue REASIGNADO tras resolverse otra (el índice único solo cubre
 * pendientes) o que ya tiene pagador con otro número NUNCA se auto-aprueba
 * con evidencia ajena: revisión manual del creador.
 */

export interface PaymentOrderTurnResult {
  /** Respuesta para el pagador; vacía = turno manejado sin responder. */
  text: string
  /** Orden de pago involucrada, para la bitácora del módulo WhatsApp. */
  orderId: string | null
  /** Texto entrante del turno, para la bitácora. */
  inboundText: string
  mediaMime: string | null
}

/**
 * Tope de tokens con forma de código que se buscan por mensaje: un mensaje
 * enorme no debe poder sondear el espacio de códigos (los tokens reales de
 * una liga o caption van en las primeras palabras).
 */
const MAX_CODE_TOKENS_PER_MESSAGE = 5

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/**
 * Primeros tokens del mensaje con FORMA de código de concepto (4 caracteres
 * del alfabeto sin 0/O/1/I), sin duplicados. La liga wa.me llega con el
 * texto prellenado; el código viaja como una palabra más y aquí se aísla.
 * Un token solo cuenta si además matchea una orden real (chequeo en BD),
 * así que un «chat» o «test» suelto nunca secuestra el turno.
 */
function findPaymentOrderCodeTokens(text: string): string[] {
  const tokens = text
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 0 && isTransferConceptCodeShape(token))
  return [...new Set(tokens)].slice(0, MAX_CODE_TOKENS_PER_MESSAGE)
}

/** Instrucciones completas para pagar la orden (paso del texto prellenado). */
function instruccionesDePago(order: PaymentOrder): string {
  return [
    `*Orden de pago ${order.code}*`,
    order.note ? `Referencia: ${order.note}` : "",
    "",
    `*Importe: ${money(order.amountMxn)}*`,
    "",
    "Paga por transferencia (SPEI) con estos datos:",
    `Banco: ${order.bank.bank}`,
    `Cuenta: ${order.bank.account}`,
    `Titular: ${order.bank.holder}`,
    `*CONCEPTO DE PAGO: ${order.code}*`,
    "",
    `Escribe SOLO el código ${order.code} como concepto en tu transferencia.`,
    "",
    "Cuando tengas el comprobante, envía por este chat SOLO la foto o el PDF (sin texto): lo reviso y confirmo tu pago.",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

/** Replay honesto del estado de una orden ya resuelta o cancelada. */
function textoEstadoResuelto(order: PaymentOrder): string {
  switch (order.status) {
    case "paid":
      return [
        `La orden de pago *${order.code}* ya está pagada`,
        order.resolvedAt ? `(confirmada el ${new Date(order.resolvedAt).toLocaleString("es-MX")})` : "",
        ". No es necesario volver a enviar el comprobante.",
      ]
        .filter((line) => line.length > 0)
        .join(" ")
    case "rejected":
      return `La orden de pago *${order.code}* fue rechazada. Si tu pago fue real, contacta a quien te emitió la orden para revisar el caso.`
    case "cancelled":
      return `La orden de pago *${order.code}* fue cancelada y el código ya no está activo. Pide una liga de pago nueva.`
    default:
      return `La orden de pago *${order.code}* ya no está activa (estado: ${order.status}).`
  }
}

/**
 * Turno de TEXTO del pagador (sin archivo): tokens con forma de código que
 * matcheen una orden pendiente → instrucciones. Null = no es un turno de
 * orden de pago (el socket sigue con la cortesía).
 */
export async function maybeHandlePaymentOrderText(input: {
  phone: string
  text: string
}): Promise<PaymentOrderTurnResult | null> {
  const order = await findPendingPaymentOrderByAnyCode(
    findPaymentOrderCodeTokens(input.text)
  ).catch(() => null)
  if (!order) return null
  await touchPaymentOrderPayer(order.id, input.phone).catch(() => {})
  logEvent("orden_pago.whatsapp_text", {
    phone: maskPhone(input.phone),
    order_id: order.id,
    code: order.code,
  })
  return {
    text: instruccionesDePago(order),
    orderId: order.id,
    inboundText: input.text,
    mediaMime: null,
  }
}

/** Veredicto del chat para el resultado de la revisión. */
function textoVeredicto(input: {
  order: PaymentOrder
  outcome: Awaited<ReturnType<typeof reviewPaymentReceipt>>
}): string {
  const orden = `orden *${input.order.code}* (${money(input.order.amountMxn)})`
  switch (input.outcome.review) {
    case "auto_approved":
      return [
        `*Pago confirmado* — el comprobante de tu ${orden} pasó la verificación (fecha, concepto, importe y beneficiario).`,
        "",
        "Gracias. Este es tu comprobante de pago confirmado.",
      ].join("\n")
    case "auto_rejected": {
      const reasons = input.outcome.scan.reasons
      return [
        `El comprobante de tu ${orden} no pasó la verificación automática:`,
        "",
        ...(reasons.length > 0
          ? reasons.map((reason) => `- ${reason}`)
          : ["- No se pudo confirmar el pago."]),
        "",
        "Tu comprobante quedó en revisión: quien te emitió la orden la resolverá y te confirmará por este chat.",
      ].join("\n")
    }
    case "manual":
      return [
        `Recibí tu comprobante para la ${orden}.`,
        "",
        "La verificación automática no se pudo completar en este momento, así que quedó *en revisión manual*: quien te emitió la orden la revisará y te confirmará por este chat.",
      ].join("\n")
    case "already_resolved":
      return textoEstadoResuelto({
        ...input.order,
        status: input.outcome.status,
      })
    case "not_a_receipt":
      return "El archivo que enviaste no parece un comprobante de transferencia. Envía SOLO la foto o el PDF del comprobante del pago (puedes escribir el código como mensaje si lo tienes a la mano)."
  }
}

/** Huella del turno no-comprobante para el veredicto del chat. */
function scanNoComprobante(advertencias: string[], modelo: string): ScanResult {
  return {
    ok: false,
    esComprobante: false,
    checks: [],
    reasons: [],
    duplicate: false,
    advertencias,
    datos: null,
    modelo,
    error: null,
  }
}

/** Aviso al creador de que su orden tiene un comprobante en revisión. */
function notifyCreatorManualReview(
  order: PaymentOrder,
  phone: string,
  sha256: string | null
): void {
  notifyPaymentOrderCreator(
    order,
    sha256,
    "Comprobante de orden de pago por revisar",
    `El pagador (WhatsApp ${maskPhone(phone)}) envió un comprobante para tu orden ${order.code} (${money(
      order.amountMxn
    )}). Revísala en Módulos → Orden de pago para aprobarla o rechazarla.`
  )
}

/** Guarda el comprobante bajo la cuenta del creador y lo liga a la orden. */
async function ligarComprobante(input: {
  order: PaymentOrder
  bytes: Uint8Array
  mimeType: string
  fileName: string | null
  sha256: string | null
}): Promise<string | null> {
  try {
    const file = await saveUserFile({
      userId: input.order.creatorUserId,
      kind: "attachment",
      fileName: input.fileName ?? "comprobante",
      mimeType: input.mimeType,
      bytes: input.bytes,
    })
    await savePaymentOrderScan({
      orderId: input.order.id,
      scanStatus: "manual",
      scanResult: null,
      scanModel: null,
      ticketFileId: file.id,
      ticketSha256: input.sha256,
    })
    return file.id
  } catch (error) {
    logEvent("orden_pago.ticket_store_error", {
      order_id: input.order.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Liga el comprobante a la orden o REUSA el ya guardado cuando es el mismo
 * archivo (mismo sha): los reenvíos de un comprobante en revisión no deben
 * acumular copias en el almacenamiento del creador.
 */
async function ligarOReusarComprobante(input: {
  order: PaymentOrder
  bytes: Uint8Array
  mimeType: string
  fileName: string | null
  sha256: string | null
}): Promise<string | null> {
  if (input.sha256 !== null && input.order.ticketSha256 === input.sha256 && input.order.ticketFileId) {
    return input.order.ticketFileId
  }
  return ligarComprobante(input)
}

/**
 * Revisión MANUAL forzada: el binding del comprobante no es inequívoco
 * (código reasignado desde una orden resuelta, o la orden ya tiene pagador
 * con otro número). El archivo queda ligado y decide el creador — jamás un
 * auto-aprueba con evidencia que podría ser de otro pago.
 */
async function revisarManualConAviso(input: {
  order: PaymentOrder
  phone: string
  bytes: Uint8Array
  mimeType: string
  fileName: string | null
  sha256: string | null
  motivo: string
}): Promise<PaymentOrderTurnResult> {
  const fileId = await ligarOReusarComprobante({
    order: input.order,
    bytes: input.bytes,
    mimeType: input.mimeType,
    fileName: input.fileName,
    sha256: input.sha256,
  })
  if (fileId === null) {
    return {
      text: "No pude registrar el comprobante en este momento. Vuelve a enviarlo en unos minutos.",
      orderId: input.order.id,
      inboundText: input.motivo,
      mediaMime: input.mimeType,
    }
  }
  logEvent("orden_pago.whatsapp_manual", {
    phone: maskPhone(input.phone),
    order_id: input.order.id,
    code: input.order.code,
    motivo: input.motivo,
  })
  notifyCreatorManualReview(input.order, input.phone, input.sha256)
  return {
    text: [
      `Recibí tu comprobante para la orden *${input.order.code}* (${money(input.order.amountMxn)}).`,
      "",
      "Por seguridad quedó *en revisión manual*: quien te emitió la orden lo verificará y te confirmará por este chat.",
    ].join("\n"),
    orderId: input.order.id,
    inboundText: input.motivo,
    mediaMime: input.mimeType,
  }
}

/**
 * Turno de COMPROBANTE del pagador (foto/PDF, solo o con caption). El
 * código IMPRESO descubre la orden; si la lectura falla, el código del
 * caption; si tampoco hay, el teléfono de un pagador ya conocido. Null =
 * no es un turno de orden de pago.
 */
export async function maybeHandlePaymentOrderReceipt(input: {
  phone: string
  text: string
  media: { mimeType: string; fileName: string | null; bytes: Uint8Array }
}): Promise<PaymentOrderTurnResult | null> {
  // Pendientes y tokens primero (baratos): con la tabla vacía de pendientes
  // y sin tokens en el caption no hay nada que descubrir — ni gasto de
  // visión ni consultas extra.
  const pending = await listPendingPaymentOrders().catch(() => [])
  const tokens = findPaymentOrderCodeTokens(input.text)
  if (pending.length === 0 && tokens.length === 0) return null

  // Cuota de escaneo por teléfono (gasta visión): sin cupo solo se responde
  // si el turno apunta a una orden pendiente real; si no, cortesía.
  if (!checkPaymentOrderScanQuota(input.phone)) {
    const known = pending.some((order) => tokens.includes(order.code))
    if (!known) return null
    return {
      text: "Alcanzaste el límite de verificaciones por minuto. Espera unos segundos y vuelve a enviar el comprobante.",
      orderId:
        pending.find((order) => tokens.includes(order.code))?.id ?? null,
      inboundText: input.text,
      mediaMime: input.media.mimeType,
    }
  }

  // La visión solo sirve para descubrir entre PENDIENTES (con la tabla
  // vacía no hay nada que leer: el replay de resueltas va por tokens).
  let extraccion: ExtraccionLLM | null = null
  if (pending.length > 0 && receiptScanConfigured()) {
    try {
      extraccion = await extraerComprobanteDeArchivo({
        bytes: input.media.bytes,
        mimeType: input.media.mimeType,
      })
    } catch (error) {
      logEvent("orden_pago.scan_error", {
        phone: maskPhone(input.phone),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Descubrimiento, de la fuente más específica a la más débil:
  //   1. código IMPRESO en el comprobante (la fuente de verdad),
  //   2. código escrito en el caption,
  //   3. teléfono de un pagador ya conocido (impreso ilegible o lector
  //      caído).
  const conceptoImpreso = extraccion?.datos?.concepto ?? null
  let candidate: PaymentOrder | null = null
  if (conceptoImpreso) {
    candidate =
      pending.find((order) =>
        conceptoImpresoCoincide(order.code, conceptoImpreso)
      ) ?? null
  }
  if (!candidate) {
    candidate =
      pending.find((order) => tokens.includes(order.code)) ?? null
  }

  // Sin orden pendiente: ¿el código corresponde a una orden YA resuelta?
  // Replay honesto del estado real (evita un segundo pago por una respuesta
  // perdida): los códigos impresos y del caption, UNA consulta.
  if (!candidate) {
    const resolved = await findResolvedPaymentOrderByAnyCode([
      ...(conceptoImpreso ? findPaymentOrderCodeTokens(conceptoImpreso) : []),
      ...tokens,
    ]).catch(() => null)
    if (resolved) {
      logEvent("orden_pago.whatsapp_replay", {
        phone: maskPhone(input.phone),
        order_id: resolved.id,
        code: resolved.code,
        status: resolved.status,
      })
      return {
        text: textoEstadoResuelto(resolved),
        orderId: resolved.id,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }

    // Fallback por teléfono: el pagador de UNA orden pendiente envía un
    // comprobante sin código legible (impreso borroso o lector caído). Con
    // varias órdenes a su nombre pedimos el código para desambiguar.
    const delPagador = pending.filter((order) => order.payerPhone === input.phone)
    if (delPagador.length === 1) {
      candidate = delPagador[0]
    } else if (delPagador.length > 1) {
      return {
        text: "Tienes varias órdenes de pago activas con este número. Envía el comprobante junto con el CÓDIGO de la que pagaste como mensaje para identificarla.",
        orderId: null,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    } else if (!extraccion) {
      // Sin lectura y sin referencias: responder honesto en vez de dejar que
      // el turno caiga a la cortesía de «no registrado» (nunca perder un
      // comprobante por un fallo del verificador).
      return {
        text: "No pude leer tu comprobante en este momento (el verificador de pagos no está disponible). Reenvía la foto en unos minutos, o escríbeme el CÓDIGO de tu orden como mensaje junto al comprobante.",
        orderId: null,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }
    if (!candidate) return null
  }

  // Binding inequívoco o revisión manual: un código que ya vivió en otra
  // orden (fue liberado al resolverse y reasignado) o una orden con pagador
  // de otro número jamás se auto-aprueban con evidencia ajena.
  const sha256 = sha256Of(input.media.bytes)
  const codigoReasignado =
    (await findResolvedPaymentOrderByAnyCode([candidate.code]).catch(() => null)) !== null
  const pagadorDistinto =
    candidate.payerPhone !== null && candidate.payerPhone !== input.phone
  if (codigoReasignado || pagadorDistinto) {
    return revisarManualConAviso({
      order: candidate,
      phone: input.phone,
      bytes: input.media.bytes,
      mimeType: input.media.mimeType,
      fileName: input.media.fileName,
      sha256,
      motivo: codigoReasignado ? "codigo_reasignado" : "pagador_distinto",
    })
  }

  await touchPaymentOrderPayer(candidate.id, input.phone).catch(() => {})

  // El archivo no es un comprobante: no se liga a la orden (el pagador subió
  // algo equivocado y puede reintentar con la foto correcta).
  if (extraccion && !extraccion.esComprobante) {
    return {
      text: textoVeredicto({
        order: candidate,
        outcome: {
          review: "not_a_receipt",
          scan: scanNoComprobante(extraccion.advertencias, extraccion.modelo),
        },
      }),
      orderId: candidate.id,
      inboundText: input.text,
      mediaMime: input.media.mimeType,
    }
  }

  // Sin verificador disponible (config ausente o lectura caída): el archivo
  // queda ligado a la orden para la revisión manual del creador — el
  // comprobante nunca se pierde.
  if (!extraccion) {
    const fileId = await ligarOReusarComprobante({
      order: candidate,
      bytes: input.media.bytes,
      mimeType: input.media.mimeType,
      fileName: input.media.fileName,
      sha256,
    })
    if (fileId === null) {
      return {
        text: "No pude registrar el comprobante en este momento. Vuelve a enviarlo en unos minutos.",
        orderId: candidate.id,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }
    logEvent("orden_pago.whatsapp_manual", {
      phone: maskPhone(input.phone),
      order_id: candidate.id,
      code: candidate.code,
    })
    notifyCreatorManualReview(candidate, input.phone, sha256)
    return {
      text: [
        `Recibí tu comprobante para la orden *${candidate.code}* (${money(candidate.amountMxn)}).`,
        "",
        "La verificación automática no está disponible en este momento, así que quedó *en revisión manual*: quien te emitió la orden la revisará y te confirmará por este chat.",
      ].join("\n"),
      orderId: candidate.id,
      inboundText: input.text,
      mediaMime: input.media.mimeType,
    }
  }

  // Reenvío del MISMO archivo ya ligado a esta orden: no guardar otra copia
  // del ticket (el sha coincide con el registrado).
  const shaYaRegistrado =
    candidate.ticketSha256 === sha256 && candidate.ticketFileId !== null
  const ticketFileId = shaYaRegistrado
    ? candidate.ticketFileId
    : (
        await saveUserFile({
          userId: candidate.creatorUserId,
          kind: "attachment",
          fileName: input.media.fileName ?? "comprobante",
          mimeType: input.media.mimeType,
          bytes: input.media.bytes,
        }).catch(() => null)
      )?.id ?? null
  if (!ticketFileId) {
    return {
      text: "No pude registrar el comprobante en este momento. Vuelve a enviarlo en unos minutos.",
      orderId: candidate.id,
      inboundText: input.text,
      mediaMime: input.media.mimeType,
    }
  }

  const outcome = await reviewPaymentReceipt({
    order: candidate,
    bytes: input.media.bytes,
    mimeType: input.media.mimeType,
    ticketFileId,
    preextracted: extraccion,
  })
  logEvent("orden_pago.whatsapp_receipt", {
    phone: maskPhone(input.phone),
    order_id: candidate.id,
    code: candidate.code,
    review: outcome.review,
  })
  return {
    text: textoVeredicto({ order: candidate, outcome }),
    orderId: candidate.id,
    inboundText: input.text,
    mediaMime: input.media.mimeType,
  }
}
