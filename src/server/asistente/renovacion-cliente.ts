import { pool } from "@/server/db"

import type { FlujoClient } from "@/lib/flujotv"
import { ACCOUNT_ENTITY_NAME } from "@/server/auth/accounts"
import { getProfile } from "@/server/auth/profile"
import { clientLicensePriceMxnOrNull } from "@/server/clientes/metadata"
import { FLUJO_PURCHASE_TIMEOUT_MS } from "@/server/flujotv/client"
import { clientDistributor } from "@/server/flujotv/scope"
import { getFlujoClient, getFlujoUserResellers } from "@/server/flujotv/service"
import { transferBankDataOrNull } from "@/server/mercadopago/config"
import {
  ORDER_ORIGIN_WA_CLIENTE,
  ORDER_ORIGIN_WA_CLIENTE_ADMIN,
  createTransferOrder,
  getTransferOrderReplayPayload,
} from "@/server/mercadopago/service"
import { createClientRenewalNotice } from "@/server/notifications/service"
import {
  checkRateLimitConceptIssuance,
  findActiveConceptsForBuyerUsers,
  findConsumedConceptsForBuyerUsers,
  getOrCreateTransferConcept,
  type ActiveConceptByCode,
} from "@/server/transferencias/concepto"
import {
  checkRateLimitReceiptScan,
  extraerComprobanteDeArchivo,
  reviewTransferReceipt,
  type ExtraccionLLM,
  type ReviewOutcome,
} from "@/server/transferencias/scan"
import { saveUserFile } from "@/server/storage/user-files"
import { canonicalWhatsAppDigits } from "@/server/whatsapp/config"
import { maybeHandlePaymentOrderReceipt } from "@/server/links-pago/whatsapp"

import { clienteEstadoLinea, conceptoImpresoCoincide, normalizeConceptCode } from "./renovacion"

/*
 * Renovación de CLIENTES FlujoTV por WhatsApp (/renovar). Los clientes NO
 * son usuarios del panel: su identidad es el teléfono guardado en
 * `client_metadata.whatsapp_phone` y su único canal es este chat. El flujo
 * reutiliza TODA la maquinaria de transferencias (concepto idempotente,
 * orden con replay, escaneo LLM, dedup sha256, guardia anti-doble) con tres
 * piezas nuevas:
 *
 *   Paso 1 — /renovar [usuario]: resuelve las licencias del teléfono, el
 *   distribuidor dueño (usuario cuya entidad Cuenta liga el reseller del
 *   cliente) y entrega concepto + importe (precio de Detalles) + datos
 *   bancarios de SU distribuidor (perfil → Datos bancarios). Sin usuario
 *   distribuidor ligado (cliente del admin): datos del env TRANSFER_* y
 *   SIN débito de saldo.
 *
 *   Paso 3 — comprobante como archivo SIN mensaje: el escaneo extrae lo
 *   impreso y el código de concepto descubre la orden, filtrado a las
 *   licencias DEL TELÉFONO (nunca otro cliente del mismo distribuidor); la
 *   orden se crea con `origin='wa_cliente'` (buyer = distribuidor) o
 *   `'wa_cliente_admin'` y el beneficiario se valida contra el bankHolder
 *   del distribuidor (`holderName` parametrizable del escaneo).
 *
 *   Resultado — la renovación avisa al CLIENTE por WhatsApp directo
 *   (`wa_outbox` kind 'client_renewal') y al distribuidor por la campana
 *   espejo que ya existe; el débito interno corre dentro de
 *   `approveTransferOrder`.
 *
 * Los textos van redactados para el cliente (sin jerga del panel, sin ids
 * internos) y con formato de WhatsApp (negrita con UN asterisco).
 */

/** Licencia asociada a un teléfono de WhatsApp (metadatos locales). */
export interface ClientLicenseEntry {
  userName: string
  priceMxn: number | null
}

/** Respuesta de la rama de clientes del socket de WhatsApp. */
export interface ClientWhatsappReply {
  text: string
  /** Comprador de la orden (distribuidor o admin), para la bitácora. */
  buyerUserId: string | null
  /** Cliente FlujoTV involucrado, para la bitácora. */
  cliente: string | null
  /** true = manejar sin responder (tope de ráfagas). */
  silent?: boolean
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

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
}

/* -------------------------------------------------------------------------- */
/*                        Guías fijas del canal cliente                       */
/* -------------------------------------------------------------------------- */

/** Guía fija para mensajes del cliente que no son /renovar ni comprobante. */
export const CLIENT_RENEWAL_GUIDE_TEXT = [
  "Soy el asistente de renovaciones de tu servicio de TV.",
  "",
  "Para renovar tu licencia envía:",
  "/renovar",
  "",
  "Te doy el concepto de pago, el importe y los datos bancarios para tu transferencia. Si tienes varias licencias, te indico cómo elegir cuál renovar.",
  "",
  "Después de pagar, envía por aquí SOLO la foto o el PDF del comprobante (sin texto) y la renovación se aplica sola.",
].join("\n")

/** Guía del paso 3 cuando el cliente escribe un código sin comprobante. */
export const CLIENT_CONCEPT_GUIDE_TEXT = [
  "Ese código es un concepto de pago. Para completar tu renovación:",
  "",
  "1. Paga la transferencia escribiendo SOLO ese código como concepto (si no tienes el importe ni los datos bancarios a la mano, envía /renovar).",
  "2. Envía por aquí SOLO la foto o el PDF del comprobante (sin texto): lo reviso y tu renovación se aplica sola.",
].join("\n")

const CLIENT_RENOVAR_RE = /^\/renovar(?:\s+([^\s]+))?$/i

/**
 * Parse del comando del cliente: `/renovar` o `/renovar <usuario>` (el
 * usuario de UNA de SUS licencias). Null si el texto no es el comando.
 */
export function parseClientRenovarCommand(
  text: string
): { arg: string | null } | null {
  const match = CLIENT_RENOVAR_RE.exec(text.trim())
  if (!match) return null
  const arg = match[1]?.trim() ?? ""
  return { arg: arg.length > 0 ? arg : null }
}

/** true si el texto tiene la FORMA de un código de concepto (paso 3). */
export function isClientConceptCodeText(text: string): boolean {
  return normalizeConceptCode(text) !== null
}

/* -------------------------------------------------------------------------- */
/*                  Resolución de clientes por teléfono                        */
/* -------------------------------------------------------------------------- */

/**
 * Licencias asociadas a un número de WhatsApp: match de dígitos contra
 * `client_metadata.whatsapp_phone` cubriendo TODAS las formas que el Detalles
 * de /clientes puede haber guardado (`normalizeWhatsappPhone`): la canónica
 * `52+10`, la mexicana legacy `521+10` y el crudo entrante, cada una con y
 * sin `+` inicial. Orden A→Z.
 */
export async function findClientsByWhatsAppPhone(
  phone: string
): Promise<ClientLicenseEntry[]> {
  const forms = new Set<string>()
  for (const value of new Set([
    canonicalWhatsAppDigits(phone),
    phone.replace(/\D+/g, ""),
  ])) {
    if (value.length === 0) continue
    forms.add(value)
    // Forma mexicana legacy (52 + 1 + 10) que el Detalles acepta y guarda.
    if (value.length === 12 && value.startsWith("52")) {
      forms.add(`521${value.slice(2)}`)
    }
  }
  const variants = [...new Set([...forms].flatMap((value) => [value, `+${value}`]))]
  const result = await pool.query<{
    user_name: string
    price_mxn: number | null
  }>(
    `SELECT user_name, price_mxn
       FROM client_metadata
      WHERE whatsapp_phone = ANY($1)
      ORDER BY user_name ASC`,
    [variants]
  )
  return result.rows.map((row) => ({
    userName: String(row.user_name),
    priceMxn:
      row.price_mxn === null || row.price_mxn === undefined
        ? null
        : Number(row.price_mxn),
  }))
}

/**
 * Usuario distribuidor cuyo perfil liga el reseller del cliente: patrón
 * inverso de `getAccountDistribuidorName` (su entidad Cuenta tiene
 * `distribuidorName` == nombre del socio). Con varios matches gana el más
 * viejo (determinista).
 */
async function findDistributorUserForReseller(
  resellerName: string
): Promise<{ userId: string } | null> {
  const name = resellerName.trim().toLowerCase()
  if (name.length === 0) return null
  const result = await pool.query<{ id: string }>(
    `SELECT u.id
       FROM users u
       JOIN entities e
         ON e.deleted_at IS NULL
        AND e.entity_name = $2
        AND e.doc->'dynamicProperties'->>'userId' = u.id
        AND e.doc->'dynamicProperties'->>'distribuidorId' = u.id
      WHERE u.role = 'sucursal'
        AND lower(e.doc->'dynamicProperties'->>'distribuidorName') = $1
      ORDER BY u.created_at ASC
      LIMIT 1`,
    [name, ACCOUNT_ENTITY_NAME]
  )
  const row = result.rows[0]
  return row ? { userId: String(row.id) } : null
}

/** Primer admin por antigüedad: comprador de las órdenes de clientes suyos. */
async function firstAdminUserId(): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'propietario' ORDER BY created_at ASC LIMIT 1`
  )
  return result.rows[0] ? String(result.rows[0].id) : null
}

export interface ClientRenewalContext {
  client: FlujoClient
  userName: string
  priceMxn: number
  /** Comprador de la orden: el distribuidor ligado o el primer admin. */
  buyerUserId: string
  /**
   * Titular receptor esperado en el comprobante (bankHolder del
   * distribuidor); null = el escaneo usa el del env (cliente del admin).
   */
  holderName: string | null
  bank: { bank: string; account: string; holder: string }
  /** true = cliente de un distribuidor (con débito interno al aprobar). */
  isDistributorClient: boolean
}

export type ClientRenewalResolution =
  | { ok: true; context: ClientRenewalContext }
  | { ok: false; reason: "panel" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "price" }
  | {
      ok: false
      reason: "bank"
      buyerUserId: string | null
      isDistributorClient: boolean
    }

/**
 * Resuelve TODO el contexto de una renovación de cliente: cliente del panel,
 * precio de Detalles, distribuidor dueño y datos bancarios de cobro
 * (perfil → Datos bancarios del distribuidor, o env para clientes del
 * admin). Nunca lanza: el fallo estructural vuelve como `reason` para que el
 * llamador responda el texto y avise al distribuidor si toca.
 */
export async function resolveClientRenewalContext(
  userNameRaw: string
): Promise<ClientRenewalResolution> {
  const userName = userNameRaw.trim()
  let client: FlujoClient | null
  try {
    client = await getFlujoClient(userName, {
      timeoutMs: FLUJO_PURCHASE_TIMEOUT_MS,
    })
  } catch {
    return { ok: false, reason: "panel" }
  }
  if (!client) return { ok: false, reason: "not_found" }

  // Precio vigente del cliente: el especial de Detalles si lo tiene, o el
  // general del servidor; null = renovación no disponible.
  const priceMxn = await clientLicensePriceMxnOrNull(client.userName)
  if (priceMxn === null) return { ok: false, reason: "price" }

  const resellerName = clientDistributor(client, await getFlujoUserResellers())
  const distributor = await findDistributorUserForReseller(resellerName)

  if (distributor) {
    const profile = await getProfile(distributor.userId).catch(() => null)
    const bankName = profile?.account?.bankName?.trim() ?? ""
    const bankHolder = profile?.account?.bankHolder?.trim() ?? ""
    const bankClabe = profile?.account?.bankClabe?.trim() ?? ""
    if (bankName.length === 0 || bankHolder.length === 0 || bankClabe.length === 0) {
      return {
        ok: false,
        reason: "bank",
        buyerUserId: distributor.userId,
        isDistributorClient: true,
      }
    }
    return {
      ok: true,
      context: {
        client,
        userName: client.userName,
        priceMxn,
        buyerUserId: distributor.userId,
        holderName: bankHolder,
        bank: { bank: bankName, account: bankClabe, holder: bankHolder },
        isDistributorClient: true,
      },
    }
  }

  // Cliente del ADMIN: ningún usuario distribuidor liga su reseller. La
  // cuenta receptora es la del env y NO hay débito de saldo (el admin
  // recibe el pago directamente).
  const bank = transferBankDataOrNull()
  const adminId = await firstAdminUserId()
  if (bank === null || adminId === null) {
    return {
      ok: false,
      reason: "bank",
      buyerUserId: adminId,
      isDistributorClient: false,
    }
  }
  return {
    ok: true,
    context: {
      client,
      userName: client.userName,
      priceMxn,
      buyerUserId: adminId,
      holderName: null,
      bank,
      isDistributorClient: false,
    },
  }
}

/** Aviso al distribuidor (o admin) de datos bancarios incompletos. */
function notifyBankMissing(
  buyerUserId: string,
  isDistributorClient: boolean,
  phone: string
): void {
  if (isDistributorClient) {
    createClientRenewalNotice({
      userId: buyerUserId,
      title: "Faltan tus datos bancarios",
      body: `Un cliente con WhatsApp ${maskPhone(phone)} intentó renovar su licencia por WhatsApp, pero no tienes los Datos bancarios completos en tu Perfil. Complétalos (Banco, Destinatario y CLABE) para recibir sus pagos.`,
    })
    return
  }
  createClientRenewalNotice({
    userId: buyerUserId,
    title: "Faltan datos bancarios del servidor",
    body: `Un cliente (WhatsApp ${maskPhone(phone)}) intentó renovar por WhatsApp, pero el servidor no tiene datos bancarios configurados (TRANSFER_BANK_NAME, TRANSFER_ACCOUNT, TRANSFER_HOLDER).`,
  })
}

/** Textos de cliente para cada fallo estructural del contexto. */
function clientTextForResolutionFailure(
  reason: "panel" | "not_found" | "price" | "bank"
): string {
  switch (reason) {
    case "panel":
      return "No pude consultar el panel en este momento. Inténtalo de nuevo en unos minutos; si persiste, contacta a tu distribuidor."
    case "not_found":
      return "No encontré tu licencia en el panel. Contacta a tu distribuidor para revisarla."
    case "price":
      return "La renovación por transferencia no está disponible en este momento. Contacta a tu distribuidor."
    case "bank":
      return "La renovación no está disponible en este momento: faltan los datos de cobro de tu distribuidor. Avísale; cuando los complete, envía /renovar de nuevo."
  }
}

/* -------------------------------------------------------------------------- */
/*                Paso 1 — /renovar: concepto de pago del cliente              */
/* -------------------------------------------------------------------------- */

/**
 * Comando `/renovar` del cliente: 0 licencias → null (la cortesía de número
 * desconocido del socket responde); 1 → directo; N → lista + `/renovar
 * <usuario>` (SOLO acepta usuarios de las licencias de ESE teléfono). Nunca
 * lanza: cualquier fallo degrada a un mensaje amable.
 */
export async function handleClientRenovarCommand(input: {
  phone: string
  arg?: string | null
}): Promise<ClientWhatsappReply | null> {
  const clients = await findClientsByWhatsAppPhone(input.phone).catch(
    () => [] as ClientLicenseEntry[]
  )
  if (clients.length === 0) return null

  const argKey = input.arg?.trim().toLowerCase() ?? ""
  let target: ClientLicenseEntry
  if (argKey.length > 0) {
    const found = clients.find(
      (client) => client.userName.toLowerCase() === argKey
    )
    if (!found) {
      return {
        text: [
          `La licencia "${input.arg?.trim()}" no está asociada a este número de WhatsApp.`,
          "",
          "Envía /renovar sin nada más para ver tus licencias.",
        ].join("\n"),
        buyerUserId: null,
        cliente: null,
      }
    }
    target = found
  } else if (clients.length > 1) {
    return {
      text: [
        "Tienes varias licencias asociadas a este número:",
        ...clients.map((client) => `- ${client.userName}`),
        "",
        `Envía /renovar con el usuario de la licencia que quieres renovar (ejemplo: /renovar ${clients[0].userName}).`,
      ].join("\n"),
      buyerUserId: null,
      cliente: null,
    }
  } else {
    target = clients[0]
  }

  const resolution = await resolveClientRenewalContext(target.userName)
  if (!resolution.ok) {
    if (resolution.reason === "bank" && resolution.buyerUserId) {
      notifyBankMissing(
        resolution.buyerUserId,
        resolution.isDistributorClient,
        input.phone
      )
    }
    return {
      text: clientTextForResolutionFailure(resolution.reason),
      buyerUserId:
        resolution.reason === "bank" ? resolution.buyerUserId : null,
      cliente: target.userName,
    }
  }
  const context = resolution.context

  // Tope de emisión de conceptos por comprador (el mismo bucket del resto
  // de los flujos de transferencia, ahora atado al distribuidor).
  if (!checkRateLimitConceptIssuance(context.buyerUserId)) {
    return {
      text: "Estoy recibiendo muchas solicitudes en este momento; espera unos segundos e inténtalo de nuevo.",
      buyerUserId: context.buyerUserId,
      cliente: context.userName,
    }
  }

  const concept = await getOrCreateTransferConcept({
    buyerUserId: context.buyerUserId,
    userName: context.userName,
  }).catch(() => null)
  if (concept === null) {
    return {
      text: "No pude generar tu concepto de pago en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, contacta a tu distribuidor.",
      buyerUserId: context.buyerUserId,
      cliente: context.userName,
    }
  }

  logEvent("cliente.renovar_command", {
    phone: maskPhone(input.phone),
    user_name: context.userName,
    concept: concept.code,
    buyer: context.buyerUserId,
    origin: context.isDistributorClient
      ? ORDER_ORIGIN_WA_CLIENTE
      : ORDER_ORIGIN_WA_CLIENTE_ADMIN,
  })

  const text = [
    `Renovación de tu licencia *${context.userName}* — 1 mes`,
    clienteEstadoLinea(context.client),
    "",
    `*Importe: ${money(context.priceMxn)}*`,
    "",
    "Paga por transferencia con estos datos:",
    `Banco: ${context.bank.bank}`,
    `Cuenta: ${context.bank.account}`,
    `Titular: ${context.bank.holder}`,
    `*CONCEPTO DE PAGO: ${concept.code}*`,
    "",
    `Escribe SOLO el código ${concept.code} como concepto en tu transferencia (el código es válido durante este mes).`,
    "",
    "Cuando tengas el comprobante, envía por este chat SOLO la foto o el PDF (sin texto): lo reviso y tu renovación se aplica sola.",
  ].join("\n")
  return { text, buyerUserId: context.buyerUserId, cliente: context.userName }
}

/* -------------------------------------------------------------------------- */
/*         Paso 3 — comprobante adjunto SIN mensaje (scan-first)              */
/* -------------------------------------------------------------------------- */

/** Lista legible de conceptos activos para guiar al cliente. */
function listaConceptos(concepts: readonly ActiveConceptByCode[]): string {
  return concepts
    .map((concept) => `- ${concept.code} → ${concept.userName}`)
    .join("\n")
}

/** Veredicto del replay: el estado REAL de una orden ya existente. */
function clientTextForOrderState(status: string, amount: number): string {
  switch (status) {
    case "processing":
    case "paid":
      return `Ya tenía registrado tu pago de ${money(amount)}: la renovación se está aplicando. No es necesario volver a enviar el comprobante; te aviso por este chat cuando quede lista.`
    case "renewed":
    case "applied":
      return "La renovación de ese pago ya está aplicada. No es necesario volver a enviar el comprobante."
    case "renewal_failed":
      return `Tu pago de ${money(amount)} estaba registrado pero la renovación falló. Tu distribuidor ya fue avisado.`
    case "rejected":
      return "Ese concepto de pago ya fue usado por una orden rechazada. Si tu pago fue real, contacta a tu distribuidor para revisar el caso."
    default:
      return `Ese concepto de pago ya fue usado por un pago en revisión (estado: ${status}). Contacta a tu distribuidor para aclarar el caso.`
  }
}

/** Veredicto de una revisión recién corrida, redactado para el cliente. */
function clientTextForReviewOutcome(
  review: ReviewOutcome,
  amount: number,
  userName: string
): string {
  if (review.review === "auto_approved") {
    return [
      `Recibí tu comprobante para *${userName}* (${money(amount)}).`,
      "",
      "El pago pasó la verificación (fecha, concepto, importe y beneficiario). Tu renovación se está aplicando: te aviso por este chat cuando quede lista (suele tardar unos minutos).",
    ].join("\n")
  }
  if (review.review === "verifying_deposit") {
    return [
      `Recibí tu comprobante para *${userName}* (${money(amount)}).`,
      "",
      "El pago pasó la verificación. Falta confirmar la acreditación del depósito en la cuenta de tu distribuidor (suele llegar en minutos); en cuanto acredite, tu renovación se aplica sola y te aviso por este chat.",
    ].join("\n")
  }
  if (review.review === "auto_rejected") {
    const reasons = review.scan?.reasons ?? []
    return [
      `Tu comprobante para *${userName}* no pasó la verificación automática:`,
      ...(reasons.length > 0
        ? reasons.map((reason) => `- ${reason}`)
        : ["- No se pudo confirmar el pago."]),
      "",
      "Tu pago quedó en revisión. Si tu transferencia fue correcta, contacta a tu distribuidor para que lo revisen.",
    ].join("\n")
  }
  return [
    `Recibí tu comprobante para *${userName}* (${money(amount)}).`,
    "",
    "No pude verificarlo automáticamente en este momento: quedó en revisión y te aviso por este chat cuando esté listo.",
  ].join("\n")
}

/**
 * Interceptor del paso 3 en la rama de clientes del socket: el adjunto que
 * manda un cliente (archivo sin mensaje, o con texto que se ignora) es su
 * comprobante de renovación. El código de concepto IMPRESO descubre a qué
 * concepto activo pertenece el pago, filtrado a las licencias DEL TELÉFONO;
 * el archivo se guarda bajo el userId del comprador (distribuidor o admin)
 * para que el flujo de revisión lo encuentre sin cambios. Devuelve null
 * cuando el teléfono no tiene licencias o el archivo no es un comprobante
 * (el socket sigue con la guía de cortesía).
 */
export async function maybeHandleClientRenewalReceipt(input: {
  phone: string
  /** Texto acompañante (mensaje o caption); no cambia el flujo. */
  message: string
  media: { mimeType: string; fileName: string | null; bytes: Buffer }
}): Promise<ClientWhatsappReply | null> {
  const clients = await findClientsByWhatsAppPhone(input.phone).catch(
    () => [] as ClientLicenseEntry[]
  )
  if (clients.length === 0) return null
  const userNames = clients.map((client) => client.userName)

  // El escaneo consume API de visión: bucket POR TELÉFONO (3/min). El
  // comprador real se resuelve después, con el concepto ya descubierto.
  if (!checkRateLimitReceiptScan(input.phone)) {
    return {
      text: "Estoy procesando varios comprobantes en este momento; espera unos segundos y vuelve a enviarlo.",
      buyerUserId: null,
      cliente: null,
    }
  }

  let extraccion: ExtraccionLLM | null = null
  try {
    extraccion = await extraerComprobanteDeArchivo({
      bytes: new Uint8Array(input.media.bytes),
      mimeType: input.media.mimeType,
    })
  } catch (error) {
    logEvent("cliente.renovar_scan_error", {
      phone: maskPhone(input.phone),
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const activeConcepts = await findActiveConceptsForBuyerUsers({
    userNames,
  }).catch(() => [] as ActiveConceptByCode[])

  // No parece un comprobante: con conceptos activos se avisa (el cliente
  // cree que ya mandó su ticket); sin ellos el turno NO se intercepta.
  if (extraccion !== null && !extraccion.esComprobante) {
    if (activeConcepts.length === 0) return null
    return {
      text: [
        "La imagen que enviaste no parece un comprobante de transferencia legible.",
        "",
        "Envía SOLO la foto o el PDF del comprobante (sin texto). Si aún no tienes tu concepto de pago, envía /renovar.",
      ].join("\n"),
      buyerUserId: null,
      cliente: null,
    }
  }

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
    // ninguna licencia del teléfono. ¿Ya fue consumido? → estado REAL de
    // esa orden (replay anti-doble pago); si no, guía sin crear nada.
    const consumed = await findConsumedConceptsForBuyerUsers({
      userNames,
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
        return {
          text: clientTextForOrderState(replay.status, replay.amount),
          buyerUserId: null,
          cliente: null,
        }
      }
    }
    // El concepto impreso no es de renovación del teléfono: ¿es una ORDEN
    // DE PAGO (cobro abierto)? Delega al canal del pagador — el MISMO
    // archivo ya fue leído, sin segundo gasto de visión. Null = no lo es y
    // el turno sigue con la guía de siempre.
    if (conceptoImpreso) {
      const paymentReply = await maybeHandlePaymentOrderReceipt({
        phone: input.phone,
        text: input.message,
        media: {
          mimeType: input.media.mimeType,
          fileName: input.media.fileName,
          bytes: new Uint8Array(input.media.bytes),
        },
        preextracted: extraccion,
      }).catch(() => null)
      if (paymentReply !== null) {
        logEvent("cliente.renovar_receipt_delegada_orden_pago", {
          phone: maskPhone(input.phone),
          order_id: paymentReply.orderId,
        })
        return { text: paymentReply.text, buyerUserId: null, cliente: null }
      }
    }
    const lines = [
      conceptoImpreso
        ? `El comprobante trae el concepto de pago "${conceptoImpreso}", que no corresponde a ninguna de tus licencias. No se registró nada.`
        : "El comprobante no trae un concepto de pago legible: no pude identificar a qué renovación pertenece. No se registró nada.",
    ]
    if (activeConcepts.length > 0) {
      lines.push(
        "",
        "Tus conceptos de pago activos este mes:",
        listaConceptos(activeConcepts)
      )
    } else {
      lines.push("", "Envía /renovar para generar tu concepto de pago.")
    }
    lines.push(
      "",
      "Si el pago fue real con otro concepto, contacta a tu distribuidor."
    )
    return { text: lines.join("\n"), buyerUserId: null, cliente: null }
  }

  if (extraccion === null && activeConcepts.length !== 1) {
    // Lector de visión caído y ambigüedad: no hay forma segura de ligar la
    // orden. Guía sin crear nada (el reintento resuelve).
    const lines = [
      "No pude leer el comprobante en este momento (el verificador no está disponible).",
    ]
    if (activeConcepts.length > 0) {
      lines.push(
        "",
        "Tus conceptos de pago activos este mes:",
        listaConceptos(activeConcepts),
        "",
        "Vuelve a enviar el comprobante en unos minutos."
      )
    } else {
      lines.push("", "Vuelve a enviarlo en unos minutos.")
    }
    return { text: lines.join("\n"), buyerUserId: null, cliente: null }
  }

  // Concepto a ligar: descubierto del comprobante, o el ÚNICO activo del
  // teléfono cuando el lector falló (la orden queda en revisión manual).
  const concept =
    candidate ??
    (extraccion === null && activeConcepts.length === 1
      ? activeConcepts[0]
      : null)
  if (!concept) return null

  const resolution = await resolveClientRenewalContext(concept.userName)
  if (!resolution.ok) {
    if (resolution.reason === "bank" && resolution.buyerUserId) {
      notifyBankMissing(
        resolution.buyerUserId,
        resolution.isDistributorClient,
        input.phone
      )
    }
    return {
      text: clientTextForResolutionFailure(resolution.reason),
      buyerUserId:
        resolution.reason === "bank" ? resolution.buyerUserId : null,
      cliente: concept.userName,
    }
  }
  const context = resolution.context

  // Invariante comprador↔concepto: el concepto puede haber sido emitido por
  // OTRA cuenta (p. ej. el admin lo generó por el sheet para un cliente de un
  // distribuidor, o hay dos distribuidores ligados al mismo reseller). Crear
  // la orden con el buyer resuelto debitaría/validaría beneficiario contra
  // una cuenta distinta de la que emitió el código: no se crea nada.
  if (concept.buyerUserId !== context.buyerUserId) {
    logEvent("cliente.renovar_receipt_buyer_mismatch", {
      phone: maskPhone(input.phone),
      user_name: concept.userName,
      concept: concept.code,
      concept_buyer: concept.buyerUserId,
      resolved_buyer: context.buyerUserId,
    })
    return {
      text: `El concepto de pago ${concept.code} fue generado por otra cuenta y no corresponde a este flujo de renovación; no se registró nada. Envía /renovar para generar tu propio concepto o contacta a tu distribuidor.`,
      buyerUserId: context.buyerUserId,
      cliente: context.userName,
    }
  }

  const origin = context.isDistributorClient
    ? ORDER_ORIGIN_WA_CLIENTE
    : ORDER_ORIGIN_WA_CLIENTE_ADMIN

  try {
    // El comprobante vive en el almacenamiento del COMPRADOR de la orden:
    // el flujo de revisión (`reviewTransferReceiptFromOrder`, «Transferencias
    // por revisar») lo lee de ahí sin cambios.
    const file = await saveUserFile({
      userId: context.buyerUserId,
      kind: "attachment",
      fileName:
        input.media.fileName ??
        (input.media.mimeType === "application/pdf"
          ? "comprobante.pdf"
          : "comprobante.jpg"),
      mimeType: input.media.mimeType,
      bytes: input.media.bytes,
    })

    const result = await createTransferOrder({
      userName: context.userName,
      months: 1,
      buyerUserId: context.buyerUserId,
      ticketFileId: file.id,
      conceptId: concept.id,
      conceptCode: concept.code,
      origin,
    })

    logEvent("cliente.renovar_receipt", {
      phone: maskPhone(input.phone),
      order_id: result.orderId,
      user_name: context.userName,
      concept: concept.code,
      buyer: context.buyerUserId,
      origin,
      replayed: result.replayed,
    })

    if (result.replayed) {
      // La orden original conserva SU ticket y su proceso: responder con su
      // estado real, sin re-escanear.
      return {
        text: clientTextForOrderState(result.status, result.amount),
        buyerUserId: context.buyerUserId,
        cliente: context.userName,
      }
    }

    const review = await reviewTransferReceipt({
      orderId: result.orderId,
      buyerUserId: context.buyerUserId,
      bytes: new Uint8Array(input.media.bytes),
      mimeType: input.media.mimeType,
      userName: context.userName,
      amountMxn: result.amount,
      conceptCode: concept.code,
      preextracted: extraccion ?? undefined,
      ...(context.holderName !== null
        ? { holderName: context.holderName }
        : {}),
      // Verificación de depósito: cliente de distribuidor → el dinero va a
      // SU cuenta (credencial propia); cliente del admin → la del env
      // (plataforma).
      deposit: {
        sellerUserId: context.isDistributorClient ? context.buyerUserId : null,
      },
    })

    logEvent("cliente.renovar_receipt_review", {
      phone: maskPhone(input.phone),
      order_id: result.orderId,
      user_name: context.userName,
      review: review.review,
    })

    return {
      text: clientTextForReviewOutcome(
        review,
        result.amount,
        context.userName
      ),
      buyerUserId: context.buyerUserId,
      cliente: context.userName,
    }
  } catch (error) {
    logEvent("cliente.renovar_receipt_error", {
      phone: maskPhone(input.phone),
      user_name: context.userName,
      concept: concept.code,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      text: `No pude registrar tu comprobante en este momento. Tu concepto de pago ${concept.code} sigue activo: vuelve a enviarlo en unos minutos; si el problema persiste, contacta a tu distribuidor.`,
      buyerUserId: context.buyerUserId,
      cliente: context.userName,
    }
  }
}
