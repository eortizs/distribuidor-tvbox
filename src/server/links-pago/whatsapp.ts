import { createHash } from "node:crypto"

import { conceptoImpresoCoincide } from "@/server/asistente/renovacion"
import {
  extraerComprobanteDeArchivo,
  receiptScanConfigured,
  type ExtraccionLLM,
  type ScanResult,
} from "@/server/transferencias/scan"
import { saveUserFile } from "@/server/storage/user-files"

import {
  desambiguarComprobantePorConcepto,
  esConceptoLibre,
  findPaymentOrderCodeTokens,
  MAX_PAYMENT_ORDER_CODE_TOKENS,
  parsePaymentOrderRequestAmount,
  paymentOrderConceptAnchor,
  paymentOrderConceptoVisible,
  PAYMENT_ORDER_CONCEPTO_MAX,
  PAYMENT_ORDER_CONCEPTO_MIN,
} from "@/lib/links-pago"
import {
  findActivePaymentOrdersByPayerPhone,
  findLatestResolvedPaymentOrderByPayerPhone,
  findPendingPaymentOrderByAnyCode,
  findResolvedPaymentOrderByAnyCode,
  findResolvedPaymentOrderByAnyConcepto,
  hasPaymentQrRequestHistory,
  listOpenPaymentQrRequestsForPayer,
  listPendingPaymentOrders,
  listPendingPaymentOrdersByAmount,
  savePaymentOrderScan,
  touchPaymentOrderPayer,
  type PaymentOrder,
} from "./repository"
import {
  checkPaymentOrderScanQuota,
  notifyPaymentOrderCreator,
  reviewPaymentReceipt,
} from "./review"
import { notifyPayerContacted } from "./notify"
import {
  respuestaConConcepto,
  textoEstadoResuelto,
  textoVerificandoDeposito,
  type PaymentOrderTurnResult,
} from "./payment-order-messages"
import {
  atenderComprobanteQr,
  maybeHandleQrPaymentText,
  TEXTO_QR_REESCANEAR,
} from "./qr-fijo"

/*
 * Canal WhatsApp del PAGADOR de una orden de pago: cualquier persona sin
 * cuenta en el panel. El socket (rama de números no registrados ni clientes)
 * llama a estos handlers; ambos devuelven null cuando el turno NO es de una
 *     orden de pago y el flujo debe seguir (silencio: el contacto ya quedó
 *     registrado al entrar).
 *
 *   Dos formatos de cobro comparten el canal: el LINK con importe y concepto
 *   definidos por el cobrador (este archivo) y el QR FIJO, de pago libre
 *   (qr-fijo.ts). El texto pasa PRIMERO por la solicitud del QR —no trae
 *   orden, trae al cobrador— y el comprobante de un pagador de QR se atiende
 *   entero en qr-fijo.ts (la orden nace de ese comprobante); lo demás sigue
 *   por las ramas de los links.
 *
 *   - Texto: el link corto spei.link llega con la SOLICITUD prellenada
 *     («Solicito un link de pago por $X (código ABCD)»): el CÓDIGO del link
 *     viaja en el mensaje e identifica la orden, así que cada link se pide y
 *     se paga por separado aunque haya otros pendientes del mismo importe.
 *     El código también llega pegado a mano, y las formas antiguas sin
 *     código («orden/liga de pago») siguen aceptándose: se resuelven por el
 *     importe y, con varias pendientes, piden el código. La respuesta va en
 *     TRES mensajes de golpe: las INSTRUCCIONES del pago (con
 *     importe/banco/titular), el CONCEPTO DE PAGO SOLO y la CLABE SOLO —
 *     concepto y CLABE sin nada más para copiar/pegar fácil. El concepto de
 *     pago (la palabra del creador) queda OCULTO hasta este momento: la
 *     entrega por WhatsApp es la única vía y binding del pagador; el código
 *     del link solo identifica y desambigua.
 *   - Comprobante (foto/PDF solo o con caption): el CONCEPTO DE PAGO
 *     IMPRESO en el comprobante descubre la orden entre las pendientes
 *     (mismo criterio de match que distribuidor y clientes); con varias
 *     órdenes de la misma palabra, el código del caption, el importe leído y
 *     el teléfono del pagador ligado a UNA de ellas desambiguan; sin
 *     impresión legible manda el código del caption, y sin ambos, el teléfono
 *     de un pagador ya conocido. El escaneo valida (concepto, importe) y
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

export type { PaymentOrderTurnResult } from "./payment-order-messages"

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

/** Guía cuando la orden por monto ya tiene pagador de OTRO número. */
function textoPagadorAjeno(): string {
  return [
    "Ese link de pago ya tiene un pagador asignado.",
    "",
    "Si es tuyo, abre de nuevo tu enlace spei.link y envía el mensaje que trae (incluye el código de tu link), o pide a quien te lo emitió el CÓDIGO (las 4 letras al final del enlace) y envíamelo como mensaje.",
  ].join("\n")
}

/** Guía cuando la solicitud no resolvió una orden concreta. */
function textoSinOrdenPorMonto(monto: number): string {
  return [
    `No encontré un link de pago pendiente por ${money(monto)}.`,
    "",
    "Verifica el importe con quien te emitió la orden; si tienes el CÓDIGO de tu link (las 4 letras al final del enlace spei.link), envíamelo como mensaje.",
  ].join("\n")
}

/** Guía cuando hay AMBIGÜEDAD de órdenes pendientes del mismo monto (solicitud sin código). */
function textoMontoAmbiguo(monto: number): string {
  return [
    `Hay varios links de pago pendientes por ${money(monto)} y tu mensaje no dice cuál es el tuyo.`,
    "",
    "Abre de nuevo tu enlace spei.link y envía el mensaje que trae (ya incluye tu código), o escríbeme el CÓDIGO de tu link (las 4 letras al final del enlace). Si no lo tienes, pídeselo a quien te lo compartió.",
  ].join("\n")
}

/** Guía cuando el comprobante coincide con varias órdenes pendientes. */
function textoComprobanteAmbiguo(): string {
  return [
    "Tu comprobante coincide con varios links de pago pendientes y no pude identificar cuál es el tuyo.",
    "",
    "Reenvía la foto o el PDF con el CÓDIGO de tu link escrito en el mensaje que la acompaña (las 4 letras al final del enlace spei.link) y lo valido contra esa orden.",
  ].join("\n")
}

/**
 * Palabras alfanuméricas (3–20, ya normalizadas: mayúsculas y sin acentos)
 * de un texto, sin duplicados y con tope: alimentan el replay de resueltas
 * por CONCEPTO DE PAGO. Solo texto de comprobantes (concepto impreso o
 * caption): el chat libre nunca sondea órdenes por palabras sueltas.
 */
function wordTokensDe(text: string): string[] {
  const tokens = text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= PAYMENT_ORDER_CONCEPTO_MIN && token.length <= PAYMENT_ORDER_CONCEPTO_MAX)
  return [...new Set(tokens)].slice(0, MAX_PAYMENT_ORDER_CODE_TOKENS)
}

/**
 * ¿El mensaje es una CONFIRMACIÓN de pago del pagador («ya pagué», «ya hice
 * la transferencia», «comprobante enviado»…)? Solo disamina cuando el
 * teléfono tiene un link ACTIVO ligado (ver abajo): el aviso del pagador
 * NO confirma nada por sí solo — responde pidiendo el comprobante, que es
 * la única evidencia que valida el pago (la revisión visual con el código
 * impreso). Frases cerradas: no matchea agradecimientos ni charla suelta.
 */
const PAYMENT_CONFIRMATION_RE =
  /\b(?:ya\s+(?:te\s+)?pagu[eé]|pagu[eé]|pagado|ya\s+hice\s+(?:la\s+)?(?:transferencia|pago)|ya\s+transfer[ií]|ya\s+realic[eé]\s+(?:el\s+)?pago|ya\s+se\s+hizo\s+el\s+pago|comprobante\s+(?:enviado|adjunto|mandado)|transferencia\s+realizada)\b/i

/**
 * Turno de CONFIRMACIÓN del pagador («ya pagué»): con un link activo
 * ligada al teléfono responde (a) el estado real si ya está verificando
 * depósito, (b) la petición EXPLÍCITA del comprobante si sigue pendiente —
 * el pagador acaba de declarar que pagó, el momento exacto para pedirle la
 * foto que valida su pago. Null = sin links activos: el turno sigue su
 * curso normal (el mensaje no es de link de pago).
 */
async function maybeHandlePaymentConfirmation(input: {
  phone: string
  text: string
}): Promise<PaymentOrderTurnResult | null> {
  if (!PAYMENT_CONFIRMATION_RE.test(input.text)) return null
  const activas = await findActivePaymentOrdersByPayerPhone(input.phone).catch(
    () => []
  )
  if (activas.length === 0) return null

  const verificando = activas.find((order) => order.status === "verifying")
  if (verificando) {
    logEvent("orden_pago.whatsapp_confirm_replay", {
      phone: maskPhone(input.phone),
      order_id: verificando.id,
      code: verificando.code,
    })
    return {
      text: textoVerificandoDeposito(verificando),
      orderId: verificando.id,
      inboundText: input.text,
      mediaMime: null,
    }
  }

  if (activas.length > 1) {
    return {
      text: "Tienes varios links de pago activos con este número. Envíame el comprobante junto con el CÓDIGO del que pagaste como mensaje para identificarlo.",
      orderId: null,
      inboundText: input.text,
      mediaMime: null,
    }
  }

  const order = activas[0]
  logEvent("orden_pago.whatsapp_confirm", {
    phone: maskPhone(input.phone),
    order_id: order.id,
    code: order.code,
  })
  // Pago libre del QR fijo: el comprobante ya llegó con la orden; solo su estado.
  if (order.origin === "qr") {
    return respuestaConConcepto(order, input.text)
  }
  return {
    text: [
      "*¡Gracias por avisar!* Para confirmar tu pago necesito tu comprobante:",
      "",
      `Adjunta en este chat la FOTO o el PDF de tu transferencia${
        esConceptoLibre(order)
          ? ""
          : ` (con el concepto de pago ${paymentOrderConceptoVisible(order)})`
      } y la valido al instante. Sin el comprobante no puedo confirmar tu pago de ${money(order.amountMxn)}.`,
    ].join("\n"),
    orderId: order.id,
    inboundText: input.text,
    mediaMime: null,
  }
}

/**
 * Turno de TEXTO del pagador (sin archivo), de la fuente más específica a
 * la más débil:
 *   1. token con forma de código que matchee una orden pendiente (el
 *      código de la solicitud prellenada del link, o uno reenviado o pegado
 *      a mano) — aquí SÍ se binda el teléfono: saber el código ES la
 *      identidad del pagador,
 *   2. replay honesto del código de una orden YA resuelta,
 *   3. SOLICITUD por monto («Solicito un link de pago por $X»: las formas
 *      SIN código de los links anteriores — las actuales traen el código y
 *      entran por el punto 1): UNA pendiente por ese importe y sin pagador
 *      de otro número → respuesta LIGANDO el teléfono: la entrega del
 *      código a ese chat es la identidad del pagador (ver
 *      `touchPaymentOrderPayer`); varias → se pide el código; ya ligada a
 *      otro número → guía sin revelar código ni datos; ninguna → replay por
 *      teléfono (orden resuelta) o guía honesta.
 *
 * Null = no es un turno de link de pago (el socket sigue y termina en silencio).
 */
export async function maybeHandlePaymentOrderText(input: {
  phone: string
  text: string
  payerName?: string | null
}): Promise<PaymentOrderTurnResult | null> {
  // QR FIJO primero: su mensaje inicial no trae orden, trae al COBRADOR (el
  // pago es libre). Devuelve null en cuanto ve que el turno no es suyo —sin
  // consultar la BD— y el turno sigue por los links.
  const qr = await maybeHandleQrPaymentText(input).catch((error: unknown) => {
    logEvent("orden_pago.qr_turn_error", {
      phone: maskPhone(input.phone),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })
  if (qr !== null) return qr

  const tokens = findPaymentOrderCodeTokens(input.text)

  const order = await findPendingPaymentOrderByAnyCode(tokens).catch(() => null)
  if (order) {
    // Saber el código ES la identidad del pagador: se liga el teléfono y
    // (solo la primera vez) se avisa al creador que su link está en uso.
    const firstBind = await touchPaymentOrderPayer(
      order.id,
      input.phone,
      input.payerName
    ).catch(() => false)
    if (firstBind) {
      notifyPayerContacted(order, input.phone)
    }
    logEvent("orden_pago.whatsapp_text", {
      phone: maskPhone(input.phone),
      order_id: order.id,
      code: order.code,
      status: order.status,
      push_name: Boolean(input.payerName),
    })
    // Orden en verificación de depósito: replay del estado en lugar de
    // re-enviar instrucciones de pago (el pago ya fue hecho y validado).
    if (order.status === "verifying") {
      return {
        text: textoVerificandoDeposito(order),
        orderId: order.id,
        inboundText: input.text,
        mediaMime: null,
      }
    }
    return respuestaConConcepto(order, input.text)
  }

  // Replay honesto: el código corresponde a una orden YA resuelta (evita
   // que el turno caiga al silencio).
  if (tokens.length > 0) {
    const resolved = await findResolvedPaymentOrderByAnyCode(tokens).catch(() => null)
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
        mediaMime: null,
      }
    }
  }

  // Confirmación de pago del pagador («ya pagué»): con link activo ligada
  // responde el estado o pide el comprobante (la revisión visual con el
  // código impreso es la única confirmación). Antes del parse de solicitud:
  // un aviso de pago no es una solicitud por monto.
  const confirmacion = await maybeHandlePaymentConfirmation(input)
  if (confirmacion !== null) return confirmacion

  const monto = parsePaymentOrderRequestAmount(input.text)
  if (monto === null) return null

  const candidatas = await listPendingPaymentOrdersByAmount(monto).catch(
    () => null
  )
  if (candidatas === null) return null

  if (candidatas.length === 0) {
    // Sin pendiente por ese monto: ¿la orden del teléfono ya se resolvió?
    const resolved = await findLatestResolvedPaymentOrderByPayerPhone(
      input.phone
    ).catch(() => null)
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
        mediaMime: null,
      }
    }
    logEvent("orden_pago.whatsapp_request_sin_orden", {
      phone: maskPhone(input.phone),
      monto,
    })
    return {
      text: textoSinOrdenPorMonto(monto),
      orderId: null,
      inboundText: input.text,
      mediaMime: null,
    }
  }

  if (candidatas.length > 1) {
    // Ambigüedad (solicitud SIN código): el monto no basta para elegir entre
    // varias pendientes y el binding por teléfono no es prueba de identidad
    // (un número reciclado pagaría al beneficiario de una orden vieja) — se
    // pide el código.
    logEvent("orden_pago.whatsapp_request_ambigua", {
      phone: maskPhone(input.phone),
      monto,
      candidatas: candidatas.length,
      codes: candidatas.map((order) => order.code),
    })
    return {
      text: textoMontoAmbiguo(monto),
      orderId: null,
      inboundText: input.text,
      mediaMime: null,
    }
  }

  const candidata = candidatas[0]
  if (candidata.payerPhone !== null && candidata.payerPhone !== input.phone) {
    // La orden ya tiene pagador de OTRO número: sin código ni datos
    // bancarios (el monto no prueba identidad) y sin tocar el binding.
    logEvent("orden_pago.whatsapp_request_bloqueada", {
      phone: maskPhone(input.phone),
      order_id: candidata.id,
      motivo: "pagador_ajeno",
    })
    return {
      text: textoPagadorAjeno(),
      orderId: null,
      inboundText: input.text,
      mediaMime: null,
    }
  }

  // SIN binding aquí: ligar el pagador requiere identidad fuerte (código
  // explícito arriba o comprobante abajo); el monto solo no lo es. Una
  // candidata en VERIFICACIÓN no recibe instrucciones de nuevo (induciría un
  // doble pago): responde su estado.
  if (candidata.status === "verifying") {
    logEvent("orden_pago.whatsapp_request_verifying", {
      phone: maskPhone(input.phone),
      order_id: candidata.id,
      code: candidata.code,
      monto,
    })
    return {
      text: textoVerificandoDeposito(candidata),
      orderId: candidata.id,
      inboundText: input.text,
      mediaMime: null,
    }
  }
  // Binding por ENTREGA DEL CÓDIGO: el sistema acaba de entregar el código
  // y la CLABE a ESTE chat — el link corto solo la comparte el cobrador con
  // su pagador, así que el chat que la solicitó (candidata ÚNICA de ese
  // monto, sin pagador de otro número, sin ambigüedad) ES el pagador. La
  // entrega del código es la identidad; el monto solo resolvió a la orden.
  // Sin esto el embudo quedaba ciego: el pagador contactaba, recibía sus
  // datos y pagaba, pero el link mostraba «aún no contacta» (caso PLJ7) y
  // el creador no recibía aviso alguno hasta el comprobante. El binding NO
  // interviene en decisiones de dinero: la confirmación sigue exigiendo el
  // comprobante validado con el código impreso.
  const firstBind = await touchPaymentOrderPayer(
    candidata.id,
    input.phone,
    input.payerName
  ).catch(() => false)
  if (firstBind) {
    notifyPayerContacted(candidata, input.phone)
  }
  logEvent("orden_pago.whatsapp_request", {
    phone: maskPhone(input.phone),
    order_id: candidata.id,
    code: candidata.code,
    monto,
    push_name: Boolean(input.payerName),
  })
  return respuestaConConcepto(candidata, input.text)
}

/** Veredicto del chat para el resultado de la revisión. */
function textoVeredicto(input: {
  order: PaymentOrder
  outcome: Awaited<ReturnType<typeof reviewPaymentReceipt>>
}): string {
  const orden = `orden *${input.order.code}* (${money(input.order.amountMxn)})`
  // En los pagos libres (QR fijo y nota digital) no hay concepto que validar
  // (ni código que pedir en el QR).
  const libre = esConceptoLibre(input.order)
  const validado = libre ? "importe correcto" : "concepto e importe correctos"
  switch (input.outcome.review) {
    case "auto_approved":
      return [
        `*Pago confirmado* — el comprobante de tu ${orden} pasó la verificación (${libre ? "importe" : "concepto e importe"}) y el depósito quedó acreditado en la cuenta.`,
        "",
        "Gracias. Este es tu comprobante de pago confirmado.",
      ].join("\n")
    case "verifying_deposit":
      return [
        `Comprobante recibido y validado para tu ${orden}: ${validado}.`,
        "",
        "Estoy confirmando la acreditación de tu depósito en la cuenta; te aviso aquí mismo en cuanto se confirme (suele tardar minutos, según tu banco puede tardar más).",
      ].join("\n")
    case "awaiting_creator":
      return [
        `Comprobante recibido y validado para tu ${orden}: ${validado}.`,
        "",
        libre
          ? "Quien te cobró confirmará la recepción de tu pago y te avisará por este chat."
          : "Quien emitió la orden confirmará la recepción de tu pago y te avisará por este chat.",
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
      return libre
        ? "El archivo que enviaste no parece un comprobante de transferencia. Envía SOLO la foto o el PDF del comprobante de tu pago."
        : "El archivo que enviaste no parece un comprobante de transferencia. Envía SOLO la foto o el PDF del comprobante del pago (puedes escribir el código como mensaje si lo tienes a la mano)."
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
    "Comprobante de link de pago por revisar",
    `El pagador (WhatsApp ${maskPhone(phone)}) envió un comprobante para tu orden ${order.code} (${money(
      order.amountMxn
    )}). Revísala en Módulos → SPEILink para aprobarla o rechazarla.`
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
 * Un comprobante que no corresponde a ninguna orden queda en silencio —la
 * regla del canal para números sin pago— SALVO que el número haya pagado
 * antes por un QR fijo: su escaneo venció (pasó la vigencia) y se le pide
 * reescanear en vez de ignorar un pago real.
 */
async function guiaQrVencido(input: {
  phone: string
  text: string
  media: { mimeType: string }
}): Promise<PaymentOrderTurnResult | null> {
  const conocido = await hasPaymentQrRequestHistory(input.phone).catch(
    () => false
  )
  if (!conocido) return null
  return {
    text: TEXTO_QR_REESCANEAR,
    orderId: null,
    inboundText: input.text,
    mediaMime: input.media.mimeType,
  }
}

/**
 * COMPROBANTE del pago libre del QR fijo: la orden nace de él en qr-fijo.ts
 * (el pagador se identifica por su teléfono); aquí solo se arma la respuesta
 * con el mismo veredicto de siempre. `lectura` es la extracción de visión
 * que este turno ya haya hecho (no se gasta dos veces).
 */
async function atenderComprobanteLibre(
  input: {
    phone: string
    text: string
    media: { mimeType: string; fileName: string | null; bytes: Uint8Array }
    payerName?: string | null
    preextracted?: ExtraccionLLM
  },
  lectura: ExtraccionLLM | null = null
): Promise<PaymentOrderTurnResult> {
  const qr = await atenderComprobanteQr({
    phone: input.phone,
    payerName: input.payerName,
    text: input.text,
    media: input.media,
    preextracted: lectura ?? input.preextracted,
  }).catch((error: unknown) => {
    logEvent("orden_pago.qr_turn_error", {
      phone: maskPhone(input.phone),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })
  const base = {
    inboundText: input.text,
    mediaMime: input.media.mimeType,
  }
  if (qr === null) {
    return {
      text: "No pude registrar tu pago en este momento. Vuelve a enviar el comprobante en unos minutos.",
      orderId: null,
      ...base,
    }
  }
  if (qr.kind === "reply") {
    return { text: qr.text, orderId: qr.orderId, ...base }
  }
  logEvent("orden_pago.whatsapp_receipt", {
    phone: maskPhone(input.phone),
    order_id: qr.order.id,
    code: qr.order.code,
    review: qr.outcome.review,
    qr: true,
  })
  return {
    text: textoVeredicto({ order: qr.order, outcome: qr.outcome }),
    orderId: qr.order.id,
    ...base,
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
  payerName?: string | null
  /**
   * Extracción de visión ya corrida por el llamador (delegación del canal
   * de renovación: el MISMO archivo ya fue leído una vez) — evita un
   * segundo gasto de visión.
   */
  preextracted?: ExtraccionLLM
}): Promise<PaymentOrderTurnResult | null> {
  // Pendientes y tokens primero (baratos): con la tabla vacía de activas
  // (pending + verifying) y sin tokens en el caption no hay nada que
  // descubrir — ni gasto de visión ni consultas extra. Con extracción
  // delegada también cuentan los tokens del concepto impreso ya leído.
  const pending = await listPendingPaymentOrders().catch(() => [])
  const tokens = findPaymentOrderCodeTokens(input.text)
  const delegadoTokens =
    input.preextracted?.datos?.concepto
      ? findPaymentOrderCodeTokens(input.preextracted.datos.concepto)
      : []
  const tokensApuntanAPendiente = tokens.some((token) =>
    pending.some((order) => order.status === "pending" && order.code === token)
  )
  const tokensApuntanAOrden = tokens.some((token) =>
    pending.some((order) => order.code === token)
  )

  // PAGO LIBRE del QR fijo: el pagador se identifica por su TELÉFONO —tiene
  // una solicitud vigente o ya pagó por un QR—. Su comprobante se atiende
  // entero en qr-fijo.ts (la orden nace de él): un reenvío del mismo archivo
  // responde su estado y uno nuevo abre otro cobro. Nada de descubrimiento
  // por concepto (allí es libre). Dos excepciones dejan el turno a los links:
  // el caption trae el código explícito de una orden activa, o el teléfono
  // también tiene links pendientes (el comprobante puede ser de uno de
  // ellos: primero se busca por su concepto, líneas abajo).
  const pagadorQr =
    pending.some(
      (order) => order.origin === "qr" && order.payerPhone === input.phone
    ) ||
    (await listOpenPaymentQrRequestsForPayer(input.phone).catch(() => []))
      .length > 0
  const linksPendientesDelTelefono = pending.some(
    (order) => order.origin !== "qr" && order.payerPhone === input.phone
  )
  if (pagadorQr && !tokensApuntanAOrden && !linksPendientesDelTelefono) {
    return atenderComprobanteLibre(input)
  }

  if (
    pending.length === 0 &&
    tokens.length === 0 &&
    delegadoTokens.length === 0
  ) {
    return guiaQrVencido(input)
  }

  // Replay barato de una orden ya EN VERIFICACIÓN: si el teléfono tiene
  // EXACTAMENTE una orden activa de link y está verifying (y ningún token
  // apunta a una pendiente), responde el estado SIN gastar visión — el
  // comprobante ya fue aprobado y el resultado llega cuando el depósito se
  // acredite. Las órdenes del QR fijo no cuentan: allí cada archivo se mira
  // por su huella (un comprobante nuevo es otro pago).
  const delTelefono = pending.filter(
    (order) => order.origin !== "qr" && order.payerPhone === input.phone
  )
  if (
    delTelefono.length === 1 &&
    delTelefono[0].status === "verifying" &&
    !tokensApuntanAPendiente
  ) {
    const verifying = delTelefono[0]
    logEvent("orden_pago.whatsapp_verifying_replay", {
      phone: maskPhone(input.phone),
      order_id: verifying.id,
      code: verifying.code,
      barato: true,
    })
    return {
      text: textoVerificandoDeposito(verifying),
      orderId: verifying.id,
      inboundText: input.text,
      mediaMime: input.media.mimeType,
    }
  }

  // Cuota de escaneo por teléfono (gasta visión): sin cupo solo se responde
  // si el turno apunta a una orden pendiente real; si no, silencio.
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
  // vacía no hay nada que leer: el replay de resueltas va por tokens). Con
  // extracción delegada NO se vuelve a gastar visión: el llamador ya leyó
  // el MISMO archivo.
  let extraccion: ExtraccionLLM | null = input.preextracted ?? null
  if (extraccion === null && pending.length > 0 && receiptScanConfigured()) {
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
  //   1. CONCEPTO DE PAGO impreso en el comprobante (la fuente de verdad;
  //      con varias órdenes de la misma palabra desambiguan el código del
  //      caption, el importe leído y el teléfono del pagador ya ligado),
  //   2. código escrito en el caption (desambiguador del link),
  //   3. teléfono de un pagador ya conocido (impreso ilegible o lector
  //      caído).
  // Las órdenes del QR fijo y las notas digitales NO participan: su concepto
  // es libre y su comprobante se identifica por teléfono (QR) o por el
  // teléfono ligado al folio (nota). Solo los LINKS matchean por palabra.
  const conceptoImpreso = extraccion?.datos?.concepto ?? null
  let candidate: PaymentOrder | null = null
  // El concepto coincide con varias órdenes y nada dejó clara la orden.
  let ambiguo = false
  let coincidentes = 0
  if (conceptoImpreso) {
    const porPalabra = pending.filter(
      (order) =>
        order.origin === "link" &&
        conceptoImpresoCoincide(paymentOrderConceptAnchor(order), conceptoImpreso)
    )
    coincidentes = porPalabra.length
    const porConcepto = desambiguarComprobantePorConcepto({
      coincidentes: porPalabra,
      importeTexto: extraccion?.datos?.importe ?? null,
      tokens,
      phone: input.phone,
    })
    ambiguo = porConcepto.ambiguo
    if (coincidentes > 1 && !ambiguo) {
      logEvent("orden_pago.whatsapp_receipt_desambiguada", {
        phone: maskPhone(input.phone),
        order_id: porConcepto.order?.id,
        code: porConcepto.order?.code,
        por: porConcepto.via,
      })
    }
    candidate = porConcepto.order
  }
  if (!candidate) {
    candidate =
      pending.find((order) => tokens.includes(order.code)) ?? null
  }

  // NOTA DIGITAL: el pagador se identifica por su TELÉFONO —ligado al abrir
  // el link con su folio— y el concepto es libre, así que no participa en el
  // matching por palabra. Eligen el código explícito del caption y, sin él,
  // la ÚNICA nota activa de ese teléfono. Con varias y sin código se pide el
  // folio (fail-closed): jamás se atribuye el comprobante a otra comanda.
  // Va ANTES del pago libre del QR para que un pagador con ambos formatos no
  // vea su nota capturada por el QR.
  const notasDelTelefono = pending.filter(
    (order) => order.origin === "nota" && order.payerPhone === input.phone
  )
  if (!candidate && notasDelTelefono.length > 0) {
    const porFolio = tokens.length
      ? notasDelTelefono.find((order) => tokens.includes(order.code)) ?? null
      : null
    if (porFolio) {
      candidate = porFolio
    } else if (notasDelTelefono.length === 1) {
      candidate = notasDelTelefono[0]
    } else {
      return {
        text: [
          "Tienes varias notas digitales activas con este número.",
          "",
          "Envía el comprobante junto con el CÓDIGO de tu nota (las 4 letras del enlace spei.link) para identificar cuál pagaste.",
        ].join("\n"),
        orderId: null,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }
  }

  // Pagador del QR fijo que también tiene links pendientes: su comprobante no
  // calzó con el concepto de ninguno (ni trajo un código), así que es un pago
  // libre — lo atiende qr-fijo.ts con la lectura de visión ya hecha.
  if (!candidate && !ambiguo && pagadorQr) {
    return atenderComprobanteLibre(input, extraccion)
  }

  // Sin orden pendiente: ¿el concepto o el código corresponden a una orden
  // YA resuelta? Replay honesto del estado real (evita un segundo pago por
  // una respuesta perdida): los códigos impresos y del caption UNA consulta,
  // y las palabras del concepto impreso OTRA (replay por concepto de pago).
  if (!candidate) {
    if (ambiguo) {
      // El concepto es ambiguo: solo el código EXPLÍCITO del caption puede
      // responder (nunca el replay por palabra). Sin él, la guía del código
      // en vez de arriesgar la orden equivocada.
      const resolvedPorCodigo =
        tokens.length > 0
          ? await findResolvedPaymentOrderByAnyCode(tokens).catch(() => null)
          : null
      if (resolvedPorCodigo) {
        logEvent("orden_pago.whatsapp_replay", {
          phone: maskPhone(input.phone),
          order_id: resolvedPorCodigo.id,
          code: resolvedPorCodigo.code,
          status: resolvedPorCodigo.status,
        })
        return {
          text: textoEstadoResuelto(resolvedPorCodigo),
          orderId: resolvedPorCodigo.id,
          inboundText: input.text,
          mediaMime: input.media.mimeType,
        }
      }
      logEvent("orden_pago.whatsapp_receipt_ambigua", {
        phone: maskPhone(input.phone),
        coincidentes,
      })
      return {
        text: textoComprobanteAmbiguo(),
        orderId: null,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }
    const resolved = await findResolvedPaymentOrderByAnyCode([
      ...(conceptoImpreso ? findPaymentOrderCodeTokens(conceptoImpreso) : []),
      ...tokens,
    ]).catch(() => null)
    const resolvedPorPalabra =
      resolved ??
      (conceptoImpreso
        ? await findResolvedPaymentOrderByAnyConcepto(
            wordTokensDe(conceptoImpreso)
          ).catch(() => null)
        : null)
    if (resolvedPorPalabra) {
      logEvent("orden_pago.whatsapp_replay", {
        phone: maskPhone(input.phone),
        order_id: resolvedPorPalabra.id,
        code: resolvedPorPalabra.code,
        status: resolvedPorPalabra.status,
      })
      return {
        text: textoEstadoResuelto(resolvedPorPalabra),
        orderId: resolvedPorPalabra.id,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }

    // Fallback por teléfono: el pagador de UNA orden pendiente de link envía
    // un comprobante sin código legible (impreso borroso o lector caído).
    // Con varias órdenes a su nombre pedimos el código para desambiguar.
    const delPagador = pending.filter(
      (order) =>
        order.origin === "link" && order.payerPhone === input.phone
    )
    if (delPagador.length === 1) {
      candidate = delPagador[0]
    } else if (delPagador.length > 1) {
      return {
        text: "Tienes varios links de pago activos con este número. Envía el comprobante junto con el CÓDIGO del que pagaste como mensaje para identificarlo.",
        orderId: null,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    } else if (!extraccion) {
      // Sin lectura y sin referencias: responder honesto en vez de dejar que
      // el turno caiga al silencio (nunca perder un comprobante por un fallo
      // del verificador).
      return {
        text: "No pude leer tu comprobante en este momento (el verificador de pagos no está disponible). Reenvía la foto en unos minutos, o escríbeme el CÓDIGO de tu orden como mensaje junto al comprobante.",
        orderId: null,
        inboundText: input.text,
        mediaMime: input.media.mimeType,
      }
    }
    if (!candidate) return guiaQrVencido(input)
  }

  // Binding inequívoco o revisión manual: un código que ya vivió en otra
  // orden (fue liberado al resolverse y reasignado) o una orden con pagador
  // de otro número jamás se auto-aprueban con evidencia ajena. Las órdenes
  // del QR FIJO solo llegan aquí por su código explícito y se exceptúan de
  // la primera: su código nunca se entrega como evidencia (el pagador se
  // identifica por su teléfono), así que uno reciclado no señala a otra
  // orden.
  const sha256 = sha256Of(input.media.bytes)
  const codigoReasignado =
    candidate.origin !== "qr" &&
    (await findResolvedPaymentOrderByAnyCode([candidate.code]).catch(
      () => null
    )) !== null
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

  await touchPaymentOrderPayer(
    candidate.id,
    input.phone,
    input.payerName
  ).catch(() => {})

  // Orden ya EN VERIFICACIÓN de depósito (comprobante aprobado por el
  // escaneo): replay del estado SIN re-escanear — ni gasto de visión ni
  // segunda orden ni doble notificación; el resultado llega por WhatsApp
  // cuando el depósito se acredite (o escale a las 24 h).
  if (candidate.status === "verifying") {
    logEvent("orden_pago.whatsapp_verifying_replay", {
      phone: maskPhone(input.phone),
      order_id: candidate.id,
      code: candidate.code,
    })
    return {
      text: textoVerificandoDeposito(candidate),
      orderId: candidate.id,
      inboundText: input.text,
      mediaMime: input.media.mimeType,
    }
  }

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

/**
 * ¿El concepto pertenece a una ORDEN DE PAGO (activa o ya resuelta)? Es la
 * puerta de DELEGACIÓN del interceptor de comprobantes de renovación: los
 * dos formatos de pago por transferencia (renovaciones tv3 y cobros
 * abiertos) comparten el canal y el concepto impreso decide a cuál pertenece
 * el comprobante. Orden del más específico al más débil: activa por
 * CONCEPTO DE PAGO impreso (misma tolerancia del descubrimiento), activa por
 * token de código exacto, resuelta por código (replay honesto) y resuelta
 * por concepto de pago. Null = no es una orden de pago: el turno sigue el
 * curso de renovación.
 */
export async function findPaymentOrderForReceiptConcept(
  concepto: string
): Promise<PaymentOrder | null> {
  const normalized = concepto.trim()
  if (normalized.length === 0) return null
  const pending = await listPendingPaymentOrders().catch(() => [])
  // Las notas digitales NO se descubren por concepto (es libre): su
  // comprobante se identifica por el teléfono ligado al folio en el canal.
  const porImpreso = pending.find(
    (order) =>
      order.origin === "link" &&
      conceptoImpresoCoincide(paymentOrderConceptAnchor(order), normalized)
  )
  if (porImpreso) return porImpreso
  const tokens = findPaymentOrderCodeTokens(normalized)
  const porToken = tokens.length
    ? pending.find((order) => tokens.includes(order.code)) ?? null
    : null
  if (porToken) return porToken
  return (
    (tokens.length
      ? await findResolvedPaymentOrderByAnyCode(tokens).catch(() => null)
      : null) ??
    (await findResolvedPaymentOrderByAnyConcepto(wordTokensDe(normalized)).catch(
      () => null
    ))
  )
}
