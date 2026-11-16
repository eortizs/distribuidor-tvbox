import { readFile } from "node:fs/promises"

import type { AuthUser } from "@/server/auth/types"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { getFlujoClient } from "@/server/flujotv/service"
import {
  formatDaysRemaining,
  formatFlujoDate,
} from "@/lib/flujotv"
import {
  transferBankDataOrNull,
} from "@/server/mercadopago/config"
import { clientLicensePriceMxnOrNull } from "@/server/clientes/metadata"
import {
  createTransferOrder,
  getTransferOrderReplayPayload,
} from "@/server/mercadopago/service"
import {
  checkRateLimitConceptIssuance,
  findActiveConceptByCodeForBuyer,
  findActiveConceptsForBuyer,
  findConsumedConceptByCodeForBuyer,
  findConsumedConceptsForBuyer,
  getOrCreateTransferConcept,
  isTransferConceptCodeShape,
  type ActiveConceptByCode,
} from "@/server/transferencias/concepto"
import {
  checkRateLimitReceiptScan,
  extraerComprobanteDeArchivo,
  reviewTransferReceipt,
  type ExtraccionLLM,
  type ReviewOutcome,
} from "@/server/transferencias/scan"
import { normalizarTexto } from "@/server/transferencias/verificar"
import { getUserFile, userFilePath } from "@/server/storage/user-files"

import { appendConversationMessage, type AssistantChannel } from "./conversations"
import type { AssistantAttachmentMeta } from "./attachments"

/*
 * Renovación pagada por transferencia bancaria desde el chat del Asistente
 * (/soporte/asistente), replicando el flujo de dos pasos del sheet de
 * /clientes con los MISMOS módulos de fondo (concepto idempotente, orden con
 * replay, escaneo LLM del comprobante, guardia anti-doble-renovación):
 *
 *   Paso 1 — /tv3<usuario> (ej. /tv3baltazar): busca al cliente en el
 *   alcance propio y entrega el concepto de pago (código de 4 caracteres,
 *   idempotente por comprador + usuario + mes) junto con los datos
 *   bancarios y el importe (plazo fijo: 1 mes).
 *
 *   Paso 3 — el comprador paga y envía por el mismo chat el comprobante como
 *   ARCHIVO ADJUNTO SIN MENSAJE. La validación sale del comprobante: el
 *   escaneo LLM extrae lo impreso y el CÓDIGO DE CONCEPTO IMPRESO identifica
 *   a qué concepto (y con él, a qué cliente/orden) pertenece el pago — igual
 *   que el criterio del sheet, donde el concepto impreso valida la orden.
 *   Con el concepto descubierto se crea la orden, se evalúan las condiciones
 *   (fecha del mes, concepto, importe, beneficiario) y se responde el
 *   veredicto: aprobado → renovación en background; rechazado → revisión del
 *   admin; escaneo caído → revisión manual.
 *
 *   Variante explícita que sigue aceptándose: adjunto CON el código como
 *   mensaje (útil para desambiguar con varios conceptos activos) — el
 *   código escrito liga la orden y el escaneo valida el impreso contra ella.
 *
 * Los turnos se persisten SIEMPRE en la conversación unificada (canal web),
 * como el resto de los intercambios del Asistente.
 */

/**
 * Normaliza el texto del mensaje a la forma del código; null si no aplica.
 * Única implementación del criterio de forma del canal de chat: la usan el
 * flujo del distribuidor (/tv3) y el de clientes por WhatsApp.
 */
export function normalizeConceptCode(message: string): string | null {
  const code = message.replace(/[\s-]+/g, "").toUpperCase()
  return isTransferConceptCodeShape(code) ? code : null
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...fields,
    })
  )
}

function money(amount: number): string {
  return `$${amount.toFixed(2)} MXN`
}

function shortOrderId(orderId: string): string {
  return orderId.slice(0, 8)
}

async function persistTurns(input: {
  userId: string
  message: string
  reply: string
  attachments: readonly AssistantAttachmentMeta[]
  channel: AssistantChannel
}): Promise<void> {
  await appendConversationMessage({
    userId: input.userId,
    role: "user",
    content: input.message,
    channel: input.channel,
    attachments: [...input.attachments],
  })
  await appendConversationMessage({
    userId: input.userId,
    role: "assistant",
    content: input.reply,
    channel: input.channel,
  })
}

/** Estado legible del cliente para el paso 1 (el mismo semáforo de /clientes). */
export function clienteEstadoLinea(input: {
  statusLabel: string
  expiresAt: string | null
  daysRemaining: number | null
}): string {
  const dias =
    input.daysRemaining !== null
      ? ` · ${formatDaysRemaining(input.daysRemaining)}`
      : ""
  return `${input.statusLabel}${dias} (vence ${formatFlujoDate(input.expiresAt)})`
}

/* -------------------------------------------------------------------------- */
/*                Paso 1 — /tv3<usuario>: concepto de pago                    */
/* -------------------------------------------------------------------------- */

/**
 * Ejecuta el comando dinámico de renovación: busca al cliente en el panel
 * (con la guarda de alcance de las compras) y entrega el concepto de pago
 * vigente con datos bancarios e importe. Nunca lanza: cualquier fallo
 * degrada a un mensaje amable que queda en la historia.
 */
export async function handleRenovarCommand(input: {
  user: AuthUser
  /** Nombre del comando SIN la barra (ej. «tv3baltazar»): es el usuario. */
  name: string
}): Promise<{ text: string }> {
  const userName = input.name.trim()

  // Precio vigente del cliente: el especial si lo tiene (client_metadata),
  // o el general del servidor.
  const price = await clientLicensePriceMxnOrNull(userName)
  if (price === null) {
    return {
      text: "El pago por transferencia no está disponible en este momento: el servidor no tiene configurado el precio de la licencia. Avisa al administrador.",
    }
  }
  const bank = transferBankDataOrNull()
  if (bank === null) {
    return {
      text: "El pago por transferencia no está disponible en este momento: faltan los datos bancarios en el servidor. Avisa al administrador o usa Mercado Pago desde **Clientes → renovar**.",
    }
  }
  if (!checkRateLimitConceptIssuance(input.user.id)) {
    return {
      text: "Demasiadas peticiones de concepto de pago en un minuto; espera unos segundos e inténtalo de nuevo.",
    }
  }

  const scope = await resolveClientScope(input.user)
  if (scope.kind === "none") {
    return {
      text: "Tu cuenta no tiene un distribuidor ligado: no puedes comprar renovaciones. Contacta al administrador.",
    }
  }

  let client: Awaited<ReturnType<typeof getFlujoClient>> = null
  try {
    client = await getFlujoClient(userName, {
      timeoutMs: FLUJO_PURCHASE_TIMEOUT_MS,
    })
  } catch {
    return {
      text: "No pude consultar el panel de FlujoTV en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
    }
  }
  if (!client) {
    return {
      text: `No encontré el cliente **${userName}** en el panel de FlujoTV. Verifica que el comando sea el usuario EXACTO de la licencia (ej. \`/tv3baltazar\`) e inténtalo de nuevo.`,
    }
  }
  if (scope.kind === "distributor") {
    const allowed = await isFlujoClientInScope(client, scope).catch(() => false)
    if (!allowed) {
      return {
        text: `El cliente **${userName}** no pertenece a tu distribuidor: no puedes renovarlo desde tu cuenta.`,
      }
    }
  }

  const concept = await getOrCreateTransferConcept({
    buyerUserId: input.user.id,
    userName,
  }).catch(() => null)
  if (concept === null) {
    return {
      text: "No pude generar el concepto de pago en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
    }
  }

  logEvent("asistente.renovar_command", {
    actor: `user:${input.user.username}`,
    user_name: userName,
    concept: concept.code,
  })

  const text = [
    `**Renovación de ${userName} por transferencia — 1 mes**`,
    "",
    `Cliente encontrado: **${userName}** (${clienteEstadoLinea(client)}).`,
    "",
    `**Realiza el pago de ${userName} con el siguiente concepto de pago: ${concept.code}**`,
    "",
    `- Importe: **${money(price)}**`,
    `- Banco: ${bank.bank}`,
    `- Cuenta: ${bank.account}`,
    `- Titular: ${bank.holder}`,
    "",
    `Escribe **SOLO el código ${concept.code}** como concepto en tu transferencia: queda ligado a este cliente y vive durante el mes actual (es el MISMO código del paso 1 de la transferencia en **Clientes → renovar**).`,
    "",
    `Cuando tengas el comprobante, **adjúntalo aquí SIN escribir mensaje (solo el archivo)**: lo escaneo y verifico que el concepto de pago impreso traiga el código ${concept.code} (además de fecha del mes, importe y beneficiario); si todo pasa, la renovación se aplica sola.`,
  ].join("\n")
  return { text }
}

/* -------------------------------------------------------------------------- */
/*          Paso 3 — comprobante adjunto SIN mensaje (scan-first)             */
/* -------------------------------------------------------------------------- */

/** Veredicto del replay: el estado REAL de una orden ya existente. */
function textForOrderState(input: {
  orderId: string
  amount: number
  status: string
  reasons: readonly string[]
}): string {
  const orden = `Orden \`${shortOrderId(input.orderId)}\` por **${money(input.amount)}**`
  switch (input.status) {
    case "processing":
    case "paid":
      return [
        "**Pago ya registrado** — este concepto ya tiene una orden aprobada.",
        "",
        `${orden}: la renovación se está aplicando en segundo plano o ya aplicó. No es necesario volver a enviar el comprobante; te llega la notificación (campana y WhatsApp) con el resultado.`,
      ].join("\n")
    case "renewed":
    case "applied":
      return [
        "**Pago ya registrado y renovación aplicada** para este concepto.",
        "",
        `${orden}: no es necesario volver a enviar el comprobante.`,
      ].join("\n")
    case "renewal_failed":
      return [
        "**Pago registrado, renovación pendiente**.",
        "",
        `${orden}: el pago ya estaba registrado pero la renovación falló; el administrador puede reintentarla. Contacta al administrador si no recibes la notificación.`,
      ].join("\n")
    case "rejected":
      return [
        "**Este concepto ya fue usado por una orden rechazada**.",
        "",
        `${orden}${input.reasons.length > 0 ? `:\n\n${input.reasons.map((reason) => `- ${reason}`).join("\n")}` : ""}.`,
        "",
        "Si el pago fue real y crees que es un error, contacta al administrador.",
      ].join("\n")
    case "cancelled":
    case "refunded":
    case "refunding":
      return [
        "**Este concepto ya fue usado** por una orden en estado `" +
          input.status +
          "`.",
        "",
        `${orden}. Contacta al administrador para aclarar el caso.`,
      ].join("\n")
    default:
      return [
        "**Este concepto ya fue usado** por una orden en revisión o proceso previo.",
        "",
        `${orden} (estado: ${input.status}).`,
      ].join("\n")
  }
}

/** Veredicto de una revisión recién corrida (auto o degradada a manual). */
function textForReviewOutcome(input: {
  review: ReviewOutcome
  orderId: string
  amount: number
  userName: string
}): string {
  if (input.review.review === "auto_approved") {
    return [
      "**Pago validado** — el comprobante cumple las condiciones: fecha del mes, concepto de pago, importe y beneficiario.",
      "",
      `Orden \`${shortOrderId(input.orderId)}\` registrada por **${money(input.amount)}**: la renovación de **${input.userName}** (1 mes) se está aplicando en segundo plano. Te llega la notificación (campana y WhatsApp) cuando termine; suele tardar unos minutos. Si quieres el estado más tarde, pregúntame por la orden \`${shortOrderId(input.orderId)}\`.`,
    ].join("\n")
  }
  if (input.review.review === "auto_rejected") {
    const reasons = input.review.scan?.reasons ?? []
    return [
      "**El comprobante no pasó la verificación automática**:",
      "",
      ...(reasons.length > 0
        ? reasons.map((reason) => `- ${reason}`)
        : ["- La verificación no pudo confirmar el pago."]),
      "",
      `La orden \`${shortOrderId(input.orderId)}\` quedó **pendiente de revisión del administrador**: tu pago NO se aplicó en automático. Revisa los puntos de arriba (el concepto debe ser el código vigente y el importe completo) y contacta al administrador para revisar el caso.`,
    ].join("\n")
  }
  return [
    "Recibí tu comprobante y registré la orden para **" +
      input.userName +
      "**.",
    "",
    `Orden \`${shortOrderId(input.orderId)}\` por **${money(input.amount)}**: la verificación automática no se pudo completar en este momento, así que quedó **en revisión manual del administrador**. Te llega la notificación (campana y WhatsApp) con el resultado.`,
  ].join("\n")
}

/** Lista legible de conceptos activos para guiar al comprador. */
function listaConceptos(concepts: readonly ActiveConceptByCode[]): string {
  return concepts
    .map((concept) => `- ${concept.code} → ${concept.userName}`)
    .join("\n")
}

/**
 * Guardia de la compra, idéntica a la de `POST /api/transferencias/orders`:
 * el precio debe estar configurado y, para distribuidores, el cliente debe
 * seguir en su alcance. Devuelve el texto de rechazo o null si todo pasa.
 */
async function receiptGate(input: {
  user: AuthUser
  userName: string
}): Promise<string | null> {
  if ((await clientLicensePriceMxnOrNull(input.userName)) === null) {
    return "El pago por transferencia no está disponible en este momento: el servidor no tiene configurado el precio de la licencia. Avisa al administrador."
  }
  const scope = await resolveClientScope(input.user)
  if (scope.kind === "none") {
    return "Tu cuenta no tiene un distribuidor ligado: no puedo registrar la compra. Contacta al administrador."
  }
  if (scope.kind === "distributor") {
    const target = await getFlujoClient(input.userName, {
      timeoutMs: FLUJO_PURCHASE_TIMEOUT_MS,
    })
    const allowed = target ? await isFlujoClientInScope(target, scope) : false
    if (!allowed) {
      return `El cliente **${input.userName}** ya no está en tu alcance: no se creó ninguna orden y el código sigue activo. Contacta al administrador.`
    }
  }
  return null
}

/**
 * true si el concepto impreso del comprobante menciona el código (tolerante).
 * Única implementación del criterio de match: distribuidor y clientes deben
 * reconocer el mismo código impreso idéntico (una tolerancia aplicada a un
 * solo canal haría matchear en la PWA y no en WhatsApp).
 */
export function conceptoImpresoCoincide(
  code: string,
  texto: string | null
): boolean {
  if (!texto) return false
  return normalizarTexto(texto).includes(normalizarTexto(code))
}

/**
 * Crea la orden ligada al concepto y corre la revisión con los bytes ya en
 * mano. `preextracted` evita la segunda llamada de visión en el flujo
 * sin mensaje (la extracción se hizo para DESCUBRIR el concepto). El CUPO de
 * escaneo lo chequea el llamador ANTES (una sola vez por envío). Lanza en
 * fallos de infraestructura: el llamador degrada a mensaje amable.
 */
async function registrarYRevisar(input: {
  user: AuthUser
  concept: ActiveConceptByCode
  ticket: AssistantAttachmentMeta
  bytes: Uint8Array
  preextracted?: ExtraccionLLM
}): Promise<string> {
  const gate = await receiptGate({
    user: input.user,
    userName: input.concept.userName,
  })
  if (gate !== null) return gate

  const result = await createTransferOrder({
    userName: input.concept.userName,
    months: 1,
    buyerUserId: input.user.id,
    ticketFileId: input.ticket.fileId,
    conceptId: input.concept.id,
    conceptCode: input.concept.code,
  })

  logEvent("asistente.renovar_receipt", {
    actor: `user:${input.user.username}`,
    order_id: result.orderId,
    user_name: input.concept.userName,
    concept: input.concept.code,
    replayed: result.replayed,
  })

  if (result.replayed) {
    // La orden original conserva SU ticket y su proceso: responder con su
    // estado real, sin re-escanear (el concepto quedó ligado a la primera
    // orden; este adjunto no reemplaza nada).
    return textForOrderState({
      orderId: result.orderId,
      amount: result.amount,
      status: result.status,
      reasons: result.reasons,
    })
  }

  const review = await reviewTransferReceipt({
    orderId: result.orderId,
    buyerUserId: input.user.id,
    bytes: input.bytes,
    mimeType: input.ticket.mimeType,
    userName: input.concept.userName,
    amountMxn: result.amount,
    conceptCode: input.concept.code,
    preextracted: input.preextracted,
  })
  logEvent("asistente.renovar_receipt_review", {
    actor: `user:${input.user.username}`,
    order_id: result.orderId,
    review: review.review,
  })
  return textForReviewOutcome({
    review,
    orderId: result.orderId,
    amount: result.amount,
    userName: input.concept.userName,
  })
}

/* -------------------------------------------------------------------------- */
/*                     Interceptor del paso 3 en la ruta                      */
/* -------------------------------------------------------------------------- */

/**
 * Interceptor del paso 3 en la ruta del chat. Se llama con cada mensaje que
 * no fue comando; devuelve la respuesta SOLO cuando el turno es un envío de
 * comprobante de renovación:
 *
 *   - Adjunto SIN mensaje → flujo scan-first: el escaneo extrae lo impreso y
 *     el CÓDIGO DE CONCEPTO IMPRESO descubre a qué concepto activo propio
 *     pertenece el pago; con él se crea la orden y se responde el veredicto.
 *     Sin coincidencia → guía con los conceptos activos; código consumido →
 *     estado REAL de la orden (replay). Sin conceptos activos, archivo que
 *     no es comprobante o escaneo sin cupo → null: el turno sigue su curso
 *     normal del chat (visión + modelo), sin secuestrar adjuntos ajenos.
 *   - Adjunto CON el código como mensaje → liga la orden al código escrito y
 *     el escaneo valida el impreso contra ella (variante explícita).
 *   - Código solo, sin adjuntos → guía del paso 3.
 *
 * Cuando responde, SIEMPRE persiste ambos turnos (user + assistant, con el
 * canal de origen); el turno del usuario conserva el comprobante como chip.
 */
export async function maybeHandleRenewalReceipt(input: {
  user: AuthUser
  message: string
  /** Adjuntos ya validados (propiedad, tipos y límites) por la ruta. */
  attachments: readonly AssistantAttachmentMeta[]
  /** Canal de origen de los turnos persistidos (default: web). */
  channel?: AssistantChannel
}): Promise<string | null> {
  const channel: AssistantChannel = input.channel ?? "web"
  const sinMensaje = input.message.length === 0
  const code = normalizeConceptCode(input.message)

  if (sinMensaje) {
    if (input.attachments.length === 0) return null
    return handleComprobanteSinMensaje({ ...input, channel })
  }
  if (code === null) return null
  return handleComprobanteConCodigo({ ...input, channel }, code)
}

/** Variante explícita: el código escrito por el comprador liga la orden. */
async function handleComprobanteConCodigo(
  input: {
    user: AuthUser
    message: string
    attachments: readonly AssistantAttachmentMeta[]
    channel: AssistantChannel
  },
  code: string
): Promise<string | null> {
  const concept = await findActiveConceptByCodeForBuyer({
    buyerUserId: input.user.id,
    code,
  }).catch(() => null)

  if (concept === null) {
    // ¿Lo consumió una orden previa del propio comprador? Responder con el
    // estado REAL de esa orden (replay idempotente).
    const consumed = await findConsumedConceptByCodeForBuyer({
      buyerUserId: input.user.id,
      code,
    }).catch(() => null)
    if (consumed) {
      const replay = await getTransferOrderReplayPayload(
        consumed.orderId
      ).catch(() => null)
      if (replay) {
        const reply = textForOrderState({
          orderId: replay.orderId,
          amount: replay.amount,
          status: replay.status,
          reasons: replay.reasons,
        })
        await persistTurns({
          userId: input.user.id,
          message: input.message,
          reply,
          attachments: input.attachments,
          channel: input.channel,
        })
        return reply
      }
    }
    return null
  }

  if (input.attachments.length === 0) {
    const reply = textConceptoSinComprobante({
      code: concept.code,
      userName: concept.userName,
      amount: await clientLicensePriceMxnOrNull(concept.userName),
    })
    await persistTurns({
      userId: input.user.id,
      message: input.message,
      reply,
      attachments: input.attachments,
      channel: input.channel,
    })
    return reply
  }

  if (input.attachments.length > 1) {
    const reply = [
      "Adjunta **un solo archivo**: el comprobante de la transferencia (foto o PDF).",
      "",
      `El concepto **${concept.code}** sigue activo para **${concept.userName}**. Quita los archivos de más y vuelve a enviar.`,
    ].join("\n")
    await persistTurns({
      userId: input.user.id,
      message: input.message,
      reply,
      attachments: input.attachments,
      channel: input.channel,
    })
    return reply
  }

  const ticket = input.attachments[0]

  // El turno del usuario (con su comprobante) se persiste ANTES de crear la
  // orden: el archivo y el intento quedan en la historia pase lo que pase.
  await appendConversationMessage({
    userId: input.user.id,
    role: "user",
    content: input.message,
    channel: input.channel,
    attachments: [ticket],
  })

  let reply: string
  try {
    const file = await getUserFile(input.user.id, ticket.fileId)
    if (!file) {
      reply =
        "El archivo del comprobante ya no existe en el servidor: súbelo de nuevo (botón «+», adjunta y envía el código como mensaje)."
    } else if (!checkRateLimitReceiptScan(input.user.id)) {
      // Sin cupo de escaneo la orden NO se crea: iría siempre a revisión
      // manual y el comprador creería que el pago se aplicó solo.
      reply =
        "Alcanzaste el límite de verificaciones por minuto. Espera unos segundos y vuelve a adjuntar el comprobante."
    } else {
      const bytes = new Uint8Array(await readFile(userFilePath(file)))
      reply = await registrarYRevisar({
        user: input.user,
        concept,
        ticket,
        bytes,
      })
    }
  } catch (error) {
    logEvent("asistente.renovar_receipt_error", {
      actor: `user:${input.user.username}`,
      user_name: concept.userName,
      concept: concept.code,
      error: error instanceof Error ? error.message : String(error),
    })
    reply = `No pude registrar el comprobante en este momento (${
      error instanceof Error ? error.message : "error inesperado"
    }). El código **${concept.code}** sigue activo: vuelve a intentarlo en unos minutos; si el problema persiste, avisa al administrador.`
  }

  await appendConversationMessage({
    userId: input.user.id,
    role: "assistant",
    content: reply,
    channel: input.channel,
  })
  return reply
}

/**
 * Flujo SIN mensaje (el principal): el concepto se DESCUBRE desde el
 * comprobante. Devuelve null cuando el adjunto no es un envío de renovación
 * (sin conceptos activos, archivo que no es comprobante o sin cupo de
 * escaneo): la ruta sigue con el flujo normal del chat.
 */
async function handleComprobanteSinMensaje(input: {
  user: AuthUser
  message: string
  attachments: readonly AssistantAttachmentMeta[]
  channel: AssistantChannel
}): Promise<string | null> {
  const activeConcepts = await findActiveConceptsForBuyer({
    buyerUserId: input.user.id,
  }).catch(() => [])
  if (activeConcepts.length === 0) return null

  if (input.attachments.length > 1) {
    const reply = [
      "Adjunta **un solo archivo**: el comprobante de la transferencia (foto o PDF).",
      "",
      "El código de concepto lo leo del comprobante impreso. Quita los archivos de más y vuelve a enviarlo.",
    ].join("\n")
    await persistTurns({
      userId: input.user.id,
      message: input.message,
      reply,
      attachments: input.attachments,
      channel: input.channel,
    })
    return reply
  }

  // El escaneo consume API de visión: sin cupo el turno NO se intercepta y
  // sigue su curso normal del chat (la renovación se hace por el sheet).
  if (!checkRateLimitReceiptScan(input.user.id)) return null

  const ticket = input.attachments[0]
  const file = await getUserFile(input.user.id, ticket.fileId).catch(() => null)
  if (!file) return null
  const bytes = await readFile(userFilePath(file)).catch(() => null)
  if (bytes === null) return null

  let extraccion: ExtraccionLLM | null = null
  try {
    extraccion = await extraerComprobanteDeArchivo({
      bytes,
      mimeType: ticket.mimeType,
    })
  } catch (error) {
    logEvent("asistente.renovar_scan_error", {
      actor: `user:${input.user.username}`,
      file_id: ticket.fileId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // No es un comprobante de transferencia: no es un envío de renovación.
  if (extraccion !== null && !extraccion.esComprobante) return null

  const conceptoImpreso =
    extraccion !== null ? extraccion.datos?.concepto ?? null : null

  let candidate: ActiveConceptByCode | null = null
  if (conceptoImpreso) {
    candidate =
      activeConcepts.find((concept) =>
        conceptoImpresoCoincide(concept.code, conceptoImpreso)
      ) ?? null
  }

  if (extraccion !== null && candidate === null) {
    // El comprobante es real pero el concepto impreso no corresponde a
    // ningún concepto activo propio. ¿Ya fue consumido este mes? → estado
    // REAL de esa orden (replay); si no, guía con los conceptos activos.
    const consumed = await findConsumedConceptsForBuyer({
      buyerUserId: input.user.id,
    }).catch(() => [])
    const consumedMatch = conceptoImpreso
      ? consumed.find((concept) =>
          conceptoImpresoCoincide(concept.code, conceptoImpreso)
        ) ?? null
      : null
    if (consumedMatch) {
      const replay = await getTransferOrderReplayPayload(
        consumedMatch.orderId
      ).catch(() => null)
      if (replay) {
        const reply = textForOrderState({
          orderId: replay.orderId,
          amount: replay.amount,
          status: replay.status,
          reasons: replay.reasons,
        })
        await persistTurns({
          userId: input.user.id,
          message: input.message,
          reply,
          attachments: input.attachments,
          channel: input.channel,
        })
        return reply
      }
    }
    const reply = [
      conceptoImpreso
        ? `El comprobante trae el concepto de pago «${conceptoImpreso}», que **no corresponde a ningún concepto activo tuyo**. No se creó ninguna orden y no se cobró nada.`
        : "El comprobante no trae un concepto de pago legible: no pude identificar a qué renovación pertenece. No se creó ninguna orden.",
      "",
      "Tus conceptos de pago activos este mes:",
      listaConceptos(activeConcepts),
      "",
      "Si el concepto impreso es otro, generó uno nuevo con `/tv3<usuario>` (ej. `/tv3baltazar`). Si el pago fue real con un concepto ya usado, contacta al administrador.",
    ].join("\n")
    await persistTurns({
      userId: input.user.id,
      message: input.message,
      reply,
      attachments: input.attachments,
      channel: input.channel,
    })
    return reply
  }

  if (extraccion === null && activeConcepts.length !== 1) {
    // Lector caído y ambigüedad de conceptos: no hay forma segura de ligar
    // la orden. Guía sin crear nada (el reintento o el sheet resuelven).
    const reply = [
      "No pude leer el comprobante en este momento (el verificador no está disponible).",
      "",
      "Tus conceptos de pago activos este mes:",
      listaConceptos(activeConcepts),
      "",
      "Vuelve a intentar el envío en unos minutos o regístralo por **Clientes → renovar → Transferencia**.",
    ].join("\n")
    await persistTurns({
      userId: input.user.id,
      message: input.message,
      reply,
      attachments: input.attachments,
      channel: input.channel,
    })
    return reply
  }

  // Concepto a ligar: descubierto del comprobante, o el ÚNICO activo cuando
  // el lector falló (la orden queda en revisión manual, nunca se pierde).
  const concept =
    candidate ??
    (extraccion === null && activeConcepts.length === 1
      ? activeConcepts[0]
      : null)
  if (!concept) return null

  // El turno del usuario (con su comprobante) se persiste ANTES de crear la
  // orden: el archivo y el intento quedan en la historia pase lo que pase.
  await appendConversationMessage({
    userId: input.user.id,
    role: "user",
    content: input.message,
    channel: input.channel,
    attachments: [ticket],
  })

  let reply: string
  try {
    reply = await registrarYRevisar({
      user: input.user,
      concept,
      ticket,
      bytes,
      preextracted: extraccion ?? undefined,
    })
  } catch (error) {
    logEvent("asistente.renovar_receipt_error", {
      actor: `user:${input.user.username}`,
      user_name: concept.userName,
      concept: concept.code,
      error: error instanceof Error ? error.message : String(error),
    })
    reply = `No pude registrar el comprobante en este momento (${
      error instanceof Error ? error.message : "error inesperado"
    }). El concepto **${concept.code}** (${concept.userName}) sigue activo: vuelve a intentarlo en unos minutos; si el problema persiste, avisa al administrador.`
  }

  await appendConversationMessage({
    userId: input.user.id,
    role: "assistant",
    content: reply,
    channel: input.channel,
  })
  return reply
}

/** Guía del paso 3 cuando llega el código sin comprobante. */
function textConceptoSinComprobante(input: {
  code: string
  userName: string
  amount: number | null
}): string {
  return [
    `El concepto de pago **${input.code}** está activo para **${input.userName}**${input.amount !== null ? ` (importe: **${money(input.amount)}**)` : ""}.`,
    "",
    "Cuando tengas el comprobante de la transferencia, **adjúntalo aquí SIN escribir mensaje (solo el archivo)**: lo escaneo, verifico que el concepto impreso traiga el código (además de fecha del mes, importe y beneficiario) y aplico la renovación.",
  ].join("\n")
}
