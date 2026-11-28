import { Boom } from "@hapi/boom"
import { rm, stat } from "node:fs/promises"
import QRCode from "qrcode"
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
} from "@whiskeysockets/baileys"

import {
  MESSAGE_STORE_MAX,
  STALE_MESSAGE_MS,
  SUPPORTED_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  cleanReplyText,
  defaultMediaFileName,
  downloadIncomingMedia,
  extractCaption,
  extractMediaInfo,
  extractText,
  log,
  logInfo,
  logger,
} from "./message-utils"
import {
  allowInbound,
  courtesyAllowed,
  createWhatsAppSession,
  jidForPhone,
  maskNumber,
  phoneFromJid,
  sendTextToJid,
  withClientComposing,
  sendImageToJid,
  type WhatsAppImagenSaliente,
  type WhatsAppSession,
  type WhatsAppStatus,
} from "./session"
import { LEGACY_TENANT_ID } from "@/server/tenant/identity"
import { findTenantById, listActiveTenants, runWithTenant } from "@/server/tenant/context"
import { whatsappAgentNumber } from "./config"
import { routeBusinessUserTurn } from "./tenant-routing"

/*
 * Gateway WhatsApp POR TENANT (§4.5 2A del plan): registro `Map<tenantId,
 * Session>` en globalThis, ciclo de vida del socket (arranque, QR, código de
 * emparejamiento, reconexión y reset) y enrutado del entrante por sesión.
 *
 * El LEGADO conserva su carpeta (`storage/whatsapp-session`), su número del
 * env y TODO su comportamiento; los negocios (2B) arrancan por número
 * declarado en `tenants.whatsapp_number` con SU carpeta y un enrutado de
 * solo cobros (intercepción de solicitud de link para usuarios del tenant,
 * flujo de pagadores para el resto, silencio en lugar de cortesía).
 */

const RECONNECT_BASE_MS = 3_000
const RECONNECT_MAX_MS = 60_000

type SessionRegistry = Map<string, WhatsAppSession>

const globalForWhatsApp = globalThis as typeof globalThis & {
  __umeWhatsappSessions?: SessionRegistry
}

function sessions(): SessionRegistry {
  const existing = globalForWhatsApp.__umeWhatsappSessions
  if (existing) return existing
  const created: SessionRegistry = new Map()
  globalForWhatsApp.__umeWhatsappSessions = created
  return created
}

/** Sesión viva del tenant (null = sin sesión arrancada). */
export function sessionForTenant(tenantId: string): WhatsAppSession | null {
  return sessions().get(tenantId) ?? null
}

/** Sesión viva del LEGADO (el único socket de 2A). */
export function legacySession(): WhatsAppSession | null {
  return sessionForTenant(LEGACY_TENANT_ID)
}

/**
 * Número declarado del tenant para la UI y el arranque: el LEGADO usa el del
 * env (sembrado en tenants.whatsapp_number al arrancar); un negocio usa el
 * que declaró en el asistente (systemPool, cache 30 s).
 */
async function declaredAgentNumber(tenantId: string): Promise<string | null> {
  if (tenantId === LEGACY_TENANT_ID) return null // resuelto por env en el arranque
  const tenant = await findTenantById(tenantId).catch(() => null)
  return tenant?.whatsappNumber ?? null
}

/**
 * Crea y registra la sesión del tenant si aún no existe (idempotente).
 * No abre el socket: eso lo hace `ensureWhatsAppSocket`.
 */
export function ensureSessionRegistered(tenantId: string, kind: "legacy" | "business"): WhatsAppSession {
  const registry = sessions()
  const existing = registry.get(tenantId)
  if (existing) return existing
  const created = createWhatsAppSession({
    tenantId,
    kind,
    agentNumber: null,
  })
  registry.set(tenantId, created)
  return created
}

// ---------------------------------------------------------------------------
// Ciclo de vida del socket de UNA sesión
// ---------------------------------------------------------------------------

/** Crea el socket Baileys de la sesión (una sola vez); no reconecta solo. */
async function ensureWhatsAppSocket(session: WhatsAppSession): Promise<void> {
  if (session.socket || session.status === "revoked") return
  if (session.restarting) return
  session.restarting = true

  try {
    // `useMultiFileAuthState` es una utilidad de Baileys (no un hook de
    // React): el nombre coincide y el linter de hooks marca falso positivo.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state: auth, saveCreds } = await useMultiFileAuthState(session.authFolder)
    // Versión del protocolo UNA vez por proceso y compartida entre sesiones:
    // sin ella un GitHub colgado retrasaría el arranque hasta el timeout.
    const { version } = await fetchLatestBaileysVersion({
      signal: AbortSignal.timeout(10_000),
    })

    const socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: auth.creds,
        keys: makeCacheableSignalKeyStore(auth.keys, logger),
      },
      browser: Browsers.macOS("Chrome"),
      // El teléfono del agente sigue recibiendo sus notificaciones propias.
      markOnlineOnConnect: false,
      // El bot no necesita historial: arranque rápido y menos tráfico.
      syncFullHistory: false,
      shouldIgnoreJid: (jid: string) =>
        isJidBroadcast(jid) || isJidNewsletter(jid),
      msgRetryCounterCache: session.msgRetryCounterCache,
      getMessage: async (key) => {
        return session.messageStore.get(`${key.remoteJid}:${key.id}`)
      },
    })

    session.socket = socket
    session.status = "connecting"
    if (!session.startedAt) session.startedAt = new Date().toISOString()

    socket.ev.on("creds.update", saveCreds)

    socket.ev.on("connection.update", (update) => {
      void handleConnectionUpdate(session, update).catch((error: unknown) =>
        log("connection_update", error)
      )
    })

    socket.ev.on("messages.upsert", (event) => {
      if (event.type !== "notify") return
      for (const message of event.messages) {
        // Tenancy (§4.2, caso explícito): el entrante corre SIEMPRE bajo el
        // tenant de SU sesión — sus lecturas/escrituras pasan RLS.
        void runWithTenant(session.tenantId, () =>
          handleIncomingMessage(session, message)
        ).catch((error: unknown) => log("incoming", error))
      }
    })

    logInfo("whatsapp.socket_created", {
      tenant: session.tenantId,
      kind: session.kind,
      registered: auth.creds.registered,
    })
  } catch (error) {
    // Creación fallida (auth corrupta, disco, red): registrar, marcar estado
    // y reagendar en vez de propagar — el servidor nunca depende del gateway.
    session.socket = null
    session.status = "close"
    session.lastDisconnectReason = error instanceof Error ? error.message : String(error)
    session.lastDisconnectAt = new Date().toISOString()
    log("socket_create", error)
    scheduleReconnect(session)
  } finally {
    session.restarting = false
  }
}

async function handleConnectionUpdate(
  session: WhatsAppSession,
  update: {
    connection?: string
    qr?: string
    lastDisconnect?: { error?: unknown }
  }
): Promise<void> {
  if (update.qr) {
    session.qr = update.qr
    logInfo("whatsapp.qr_issued", { tenant: session.tenantId })
  }

  if (update.connection === "open") {
    session.qr = null
    session.status = "open"
    session.pairedAt = session.pairedAt ?? new Date().toISOString()
    session.reconnectDelayMs = RECONNECT_BASE_MS
    logInfo("whatsapp.connected", { tenant: session.tenantId })
    await markTenantWhatsappLinked(session.tenantId)
    return
  }

  if (update.connection === "close") {
    session.socket = null
    const boom = update.lastDisconnect?.error as Boom | undefined
    const statusCode = boom?.output?.statusCode ?? null
    session.lastDisconnectCode = statusCode
    session.lastDisconnectAt = new Date().toISOString()
    session.lastDisconnectReason = boom?.output?.payload?.message ?? null

    if (statusCode === DisconnectReason.loggedOut) {
      // Desvinculado desde el teléfono: no reconecta en bucle; el propietario
      // re-vincula desde el módulo (borrando la sesión vieja).
      session.status = "revoked"
      session.qr = null
      logInfo("whatsapp.revoked", { tenant: session.tenantId, status_code: statusCode })
      await markTenantWhatsappSeen(session.tenantId)
      return
    }

    session.status = "close"
    await markTenantWhatsappSeen(session.tenantId)
    scheduleReconnect(session)
    return
  }
}

/** Reconexión con backoff (deploy, corte de red, reinicio del servidor). */
function scheduleReconnect(session: WhatsAppSession): void {
  if (session.reconnectTimer) return
  const delay = session.reconnectDelayMs
  session.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS)
  const timer = setTimeout(() => {
    session.reconnectTimer = null
    void ensureWhatsAppSocket(session).catch((error: unknown) => {
      log("reconnect", error)
      scheduleReconnect(session)
    })
  }, delay)
  timer.unref?.()
  session.reconnectTimer = timer
}

/** Cierra el socket de la sesión SIN borrar su carpeta (suspensión). */
export async function stopTenantSession(tenantId: string): Promise<void> {
  const session = sessions().get(tenantId)
  if (!session) return
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer)
    session.reconnectTimer = null
  }
  try {
    await session.socket?.end(undefined)
  } catch {
    // El socket ya estaba caído.
  }
  session.socket = null
  session.status = "disabled"
  sessions().delete(tenantId)
}

// Marcas de sesión en `tenants` (2B las consume para el estado del módulo):
// best-effort y detached — jamás rompen el flujo del socket.

async function markTenantWhatsappLinked(tenantId: string): Promise<void> {
  if (tenantId === LEGACY_TENANT_ID) return
  try {
    const { systemPool } = await import("@/server/db")
    await systemPool.query(
      `UPDATE tenants SET whatsapp_linked_at = now(), whatsapp_last_seen_at = now(), updated_at = now()
        WHERE id = $1 AND kind = 'business'`,
      [tenantId]
    )
  } catch (error) {
    log("tenant_link_mark", error)
  }
}

async function markTenantWhatsappSeen(tenantId: string): Promise<void> {
  if (tenantId === LEGACY_TENANT_ID) return
  try {
    const { systemPool } = await import("@/server/db")
    await systemPool.query(
      `UPDATE tenants SET whatsapp_last_seen_at = now(), updated_at = now()
        WHERE id = $1 AND kind = 'business'`,
      [tenantId]
    )
  } catch (error) {
    log("tenant_seen_mark", error)
  }
}

// ---------------------------------------------------------------------------
// Enrutado del entrante POR sesión
// ---------------------------------------------------------------------------

/** Respuesta silenciosa: turno manejado sin responder (tope de ráfagas). */
const SILENT_CLIENT_REPLY = {
  text: "",
  buyerUserId: null,
  cliente: null,
  silent: true,
}

const SILENT_CLIENT_RESULT = (inboundText: string, mediaMime: string | null) => ({
  reply: SILENT_CLIENT_REPLY,
  inboundText,
  mediaMime,
})

/**
 * Turno de orden de pago manejado SIN responder (tope de ráfagas o aviso
 * ya gastado): la rama se apropia del mensaje y responde silencio.
 */
const SILENT_PAYMENT_ORDER_RESULT = (inboundText: string, mediaMime: string | null) => ({
  text: "",
  orderId: null,
  inboundText,
  mediaMime,
})

/**
 * Rama de ÓRDENES DE PAGO (números que no son usuarios ni clientes): el
 * pagador externo de links paga aquí con el código de concepto de su link
 * corto y manda el comprobante por el mismo chat. Null = el turno no apunta
 * a ninguna orden de pago → silencio (el contacto ya quedó registrado).
 */
async function handlePaymentOrderIncomingMessage(
  session: WhatsAppSession,
  input: { jid: string; phone: string; m: WAMessage }
): Promise<
  (import("@/server/links-pago/whatsapp").PaymentOrderTurnResult) | null
> {
  const { maybeHandlePaymentOrderReceipt, maybeHandlePaymentOrderText } =
    await import("@/server/links-pago/whatsapp")

  const text = extractText(input.m.message)
  const caption = extractCaption(input.m.message)
  const mediaInfo = extractMediaInfo(input.m.message)
  const messageText = (text || caption).trim()

  // Solo texto (el link wa.me llega con la SOLICITUD prellenada del monto;
  // el código puede venir pegado o reenviado a mano).
  if (!mediaInfo) {
    if (messageText.length === 0) return null
    if (!allowInbound(session, input.phone)) {
      // Apropiarse el turno en silencio (como la pata de medios y la rama de
      // clientes): devolver null dejaría el mensaje fuera de la bitácora para
      // un pagador con orden pendiente.
      return SILENT_PAYMENT_ORDER_RESULT(messageText, null)
    }
    return withClientComposing(session, input.jid, () =>
      maybeHandlePaymentOrderText({
        phone: input.phone,
        text: messageText,
        payerName: input.m.pushName,
      })
    )
  }

  // Tipos fuera del catálogo (video, audio, stickers…): aviso de cortesía.
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaInfo.mimeType)) {
    if (!courtesyAllowed(session, input.phone)) {
      return SILENT_PAYMENT_ORDER_RESULT(messageText, mediaInfo.mimeType)
    }
    return {
      text: "Por ahora solo puedo recibir la FOTO o el PDF del comprobante de pago.",
      orderId: null,
      inboundText: messageText,
      mediaMime: mediaInfo.mimeType,
    }
  }

  if (!allowInbound(session, input.phone)) {
    return SILENT_PAYMENT_ORDER_RESULT(messageText, mediaInfo.mimeType)
  }

  return withClientComposing(session, input.jid, async () => {
    const socket = session.socket
    if (!socket) return null
    let bytes: Buffer
    try {
      bytes = await downloadIncomingMedia(input.m, socket)
    } catch (error) {
      log("media_download", error)
      return {
        text: "No pude leer el archivo que enviaste (pudo expirar o pesar demasiado). Inténtalo de nuevo.",
        orderId: null,
        inboundText: messageText,
        mediaMime: mediaInfo.mimeType,
      }
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return {
        text: `El archivo supera el límite de ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB. Envía un comprobante más ligero.`,
        orderId: null,
        inboundText: messageText,
        mediaMime: mediaInfo.mimeType,
      }
    }
    return maybeHandlePaymentOrderReceipt({
      phone: input.phone,
      text: messageText,
      payerName: input.m.pushName,
      media: {
        mimeType: mediaInfo.mimeType,
        fileName: mediaInfo.fileName,
        bytes,
      },
    })
  })
}

/**
 * Rama de CLIENTES FlujoTV SOLO DEL LEGADO (números sin cuenta de usuario):
 * renuevan por aquí con su teléfono como identidad — `/renovar` entrega
 * concepto + importe + datos bancarios del distribuidor y el comprobante
 * entra como archivo sin mensaje. Null = el teléfono no tiene licencias.
 */
async function handleClientIncomingMessage(
  session: WhatsAppSession,
  input: { jid: string; phone: string; m: WAMessage }
): Promise<{
  reply: import("@/server/asistente/renovacion-cliente").ClientWhatsappReply
  inboundText: string
  mediaMime: string | null
} | null> {
  const {
    CLIENT_CONCEPT_GUIDE_TEXT,
    CLIENT_RENEWAL_GUIDE_TEXT,
    findClientsByWhatsAppPhone,
    handleClientRenovarCommand,
    isClientConceptCodeText,
    maybeHandleClientRenewalReceipt,
    parseClientRenovarCommand,
  } = await import("@/server/asistente/renovacion-cliente")

  const clients = await findClientsByWhatsAppPhone(input.phone).catch(
    () => []
  )
  if (clients.length === 0) return null

  const text = extractText(input.m.message)
  const caption = extractCaption(input.m.message)
  const mediaInfo = extractMediaInfo(input.m.message)
  const messageText = (text || caption).trim()

  // QR FIJO de cobro (pago libre): su solicitud —o un ARCHIVO enviado por un
  // teléfono con una solicitud vigente— va a la rama de pagos: un cliente
  // del distribuidor también puede comprar algo con su QR, y aquí lo
  // atendería la guía de renovación. Null = este cliente no está en ese caso
  // y la rama de clientes sigue.
  const { claimsQrPaymentTurn, hasOpenQrRequest } = await import(
    "@/server/links-pago/qr-fijo"
  )
  if (claimsQrPaymentTurn(messageText)) return null
  if (mediaInfo && (await hasOpenQrRequest(input.phone).catch(() => false))) {
    return null
  }

  // /renovar [usuario]: comando del cliente (fuera de SLASH_COMMANDS a
  // propósito; los distribuidores conservan /tv3<usuario>).
  const renovar = parseClientRenovarCommand(messageText)
  if (renovar) {
    if (!allowInbound(session, input.phone)) {
      return SILENT_CLIENT_RESULT(messageText, null)
    }
    const reply = await withClientComposing(session, input.jid, () =>
      handleClientRenovarCommand({ phone: input.phone, arg: renovar.arg })
    )
    if (reply === null) {
      // El comando no resolvió licencias (p. ej. la re-lectura interna falló):
      // guía fija con cortesía, nunca «no registrado» para un cliente conocido.
      if (!courtesyAllowed(session, input.phone)) {
        return SILENT_CLIENT_RESULT(messageText, null)
      }
      return {
        reply: {
          text: CLIENT_RENEWAL_GUIDE_TEXT,
          buyerUserId: null,
          cliente: null,
        },
        inboundText: messageText,
        mediaMime: null,
      }
    }
    return { reply, inboundText: messageText, mediaMime: null }
  }

  if (mediaInfo) {
    // Tipos fuera del catálogo (video, audio, stickers…): aviso de cortesía.
    if (!SUPPORTED_MEDIA_TYPES.includes(mediaInfo.mimeType)) {
      if (!courtesyAllowed(session, input.phone)) {
        return SILENT_CLIENT_RESULT(messageText, mediaInfo.mimeType)
      }
      return {
        reply: {
          text: "Por ahora solo puedo recibir la FOTO o el PDF del comprobante de tu transferencia. Para renovar, envía /renovar.",
          buyerUserId: null,
          cliente: null,
        },
        inboundText: messageText,
        mediaMime: mediaInfo.mimeType,
      }
    }
    if (!allowInbound(session, input.phone)) {
      return SILENT_CLIENT_RESULT(messageText, mediaInfo.mimeType)
    }
    const reply = await withClientComposing(session, input.jid, async () => {
      const socket = session.socket
      if (!socket) return null
      let bytes: Buffer
      try {
        bytes = await downloadIncomingMedia(input.m, socket)
      } catch (error) {
        log("media_download", error)
        return {
          text: "No pude leer el archivo que enviaste (pudo expirar o pesar demasiado). Inténtalo de nuevo.",
          buyerUserId: null,
          cliente: null,
        }
      }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        return {
          text: `El archivo supera el límite de ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB. Envía un comprobante más ligero.`,
          buyerUserId: null,
          cliente: null,
        }
      }
      return maybeHandleClientRenewalReceipt({
        phone: input.phone,
        message: messageText,
        media: {
          mimeType: mediaInfo.mimeType,
          fileName: mediaInfo.fileName,
          bytes,
        },
      })
    })
    if (reply === null) {
      // Cliente CON licencias cuyo adjunto no es un envío de renovación:
      // guía fija del flujo (con cortesía), nunca la cortesía de «no
      // registrado» que le diría algo falso sobre su número.
      if (!courtesyAllowed(session, input.phone)) {
        return SILENT_CLIENT_RESULT(messageText, mediaInfo.mimeType)
      }
      return {
        reply: {
          text: CLIENT_RENEWAL_GUIDE_TEXT,
          buyerUserId: null,
          cliente: null,
        },
        inboundText: messageText,
        mediaMime: mediaInfo.mimeType,
      }
    }
    return { reply, inboundText: messageText, mediaMime: mediaInfo.mimeType }
  }

  // Texto con forma de código de 4 caracteres: guía del paso 3.
  if (messageText.length > 0 && isClientConceptCodeText(messageText)) {
    if (!allowInbound(session, input.phone)) {
      return SILENT_CLIENT_RESULT(messageText, null)
    }
    return {
      reply: {
        text: CLIENT_CONCEPT_GUIDE_TEXT,
        buyerUserId: null,
        cliente: null,
      },
      inboundText: messageText,
      mediaMime: null,
    }
  }

  // Resto de mensajes del cliente: guía fija del flujo, limitada a 1/24 h
  // (la misma cortesía que raciona los avisos del canal).
  if (!courtesyAllowed(session, input.phone)) {
    return SILENT_CLIENT_RESULT(messageText, null)
  }
  return {
    reply: {
      text: CLIENT_RENEWAL_GUIDE_TEXT,
      buyerUserId: null,
      cliente: null,
    },
    inboundText: messageText,
    mediaMime: null,
  }
}

async function handleIncomingMessage(
  session: WhatsAppSession,
  m: WAMessage
): Promise<void> {
  if (!m.key || m.key.fromMe || !m.message) return
  const jid = m.key.remoteJid
  if (!jid) return
  if (isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return

  // Guarda el plano para reintentos de descifrado (getMessage), con tope.
  if (m.key.id) {
    if (session.messageStore.size > MESSAGE_STORE_MAX) {
      const firstKey = session.messageStore.keys().next().value
      if (firstKey) session.messageStore.delete(firstKey)
    }
    session.messageStore.set(`${jid}:${m.key.id}`, m.message)
  }

  // Backfill antiguo (colas de días) no se responde.
  const tsSeconds = m.messageTimestamp
    ? typeof m.messageTimestamp === "number"
      ? m.messageTimestamp
      : Number(m.messageTimestamp)
    : 0
  if (tsSeconds > 0 && Date.now() - tsSeconds * 1000 > STALE_MESSAGE_MS) return

  const phone = await phoneFromJid(session, jid)
  if (!phone) {
    log(`incoming_unresolvable_jid ${jid}`)
    return
  }

  const {
    findUserByWhatsAppPhone,
    logWhatsAppMessageDetached,
    registerWhatsAppContactDetached,
  } = await import("./service")
  const user = await findUserByWhatsAppPhone(phone)
  if (!user) {
    registerWhatsAppContactDetached({ phone, pushName: m.pushName })
    if (session.kind === "business") {
      // NEGOCIO (§4.5 2B): solo pagadores. Sin usuario → rama de órdenes de
      // pago; sin orden → SILENCIO (sin cortesía, sin agente).
      const paymentHandled = await handlePaymentOrderIncomingMessage(session, {
        jid,
        phone,
        m,
      }).catch((error: unknown) => {
        log("payment_order_branch", error)
        return null
      })
      if (paymentHandled === null) {
        // Sin orden: silencio (routeBusinessUnknownTurn: es el número del
        // negocio, sin cortesía de «no registrado»). Diagnóstico en log.
        log(`incoming_business_silent phone=${phone} jid=${jid}`)
        return
      }
      logWhatsAppMessageDetached({
        direction: "in",
        userId: null,
        phone,
        text:
          paymentHandled.inboundText ||
          (paymentHandled.mediaMime
            ? `[archivo: ${paymentHandled.mediaMime}]`
            : ""),
        meta: {
          jid,
          rama: "orden_pago",
          order: paymentHandled.orderId,
          tenant: session.tenantId,
          media: paymentHandled.mediaMime,
        },
      })
      const respuestas = [
        paymentHandled.text,
        ...(paymentHandled.additionalTexts ?? []),
      ].filter((texto) => texto.length > 0)
      for (const respuesta of respuestas) {
        await sendTextToJid(session, jid, respuesta).catch(
          (error: unknown) => log("payment_order_reply", error)
        )
        logWhatsAppMessageDetached({
          direction: "out",
          userId: null,
          phone,
          text: respuesta,
          meta: {
            jid,
            source: "payment_order",
            order: paymentHandled.orderId,
            tenant: session.tenantId,
          },
        })
      }
      return
    }

    // LEGADO: rama de CLIENTES FlujoTV (no son usuarios del panel; renuevan
    // por aquí con su teléfono como identidad). Null = el teléfono no tiene
    // licencias → sigue a la rama de pagos.
    const clientHandled = await handleClientIncomingMessage(session, {
      jid,
      phone,
      m,
    }).catch((error: unknown) => {
      log("client_branch", error)
      return null
    })
    if (clientHandled !== null) {
      logWhatsAppMessageDetached({
        direction: "in",
        userId: clientHandled.reply.buyerUserId,
        phone,
        text:
          clientHandled.inboundText ||
          (clientHandled.mediaMime
            ? `[archivo: ${clientHandled.mediaMime}]`
            : ""),
        meta: {
          jid,
          rama: "cliente",
          cliente: clientHandled.reply.cliente,
          media: clientHandled.mediaMime,
        },
      })
      if (!clientHandled.reply.silent && clientHandled.reply.text.length > 0) {
        await sendTextToJid(session, jid, clientHandled.reply.text).catch(
          (error: unknown) => log("client_reply", error)
        )
        logWhatsAppMessageDetached({
          direction: "out",
          userId: clientHandled.reply.buyerUserId,
          phone,
          text: clientHandled.reply.text,
          meta: {
            jid,
            source: "client_renewal",
            cliente: clientHandled.reply.cliente,
          },
        })
      }
      return
    }
    // Rama de ÓRDENES DE PAGO: el pagador externo de links (cualquier
    // persona) solicita la orden aquí. Null = el turno no apunta a ninguna
    // orden → silencio (el contacto ya quedó registrado).
    const paymentHandled = await handlePaymentOrderIncomingMessage(session, {
      jid,
      phone,
      m,
    }).catch((error: unknown) => {
      log("payment_order_branch", error)
      return null
    })
    if (paymentHandled !== null) {
      logWhatsAppMessageDetached({
        direction: "in",
        userId: null,
        phone,
        text:
          paymentHandled.inboundText ||
          (paymentHandled.mediaMime
            ? `[archivo: ${paymentHandled.mediaMime}]`
            : ""),
        meta: {
          jid,
          rama: "orden_pago",
          order: paymentHandled.orderId,
          media: paymentHandled.mediaMime,
        },
      })
      // La respuesta puede viajar en VARIOS mensajes (orden de pago: el
      // CÓDIGO solo primero, luego la explicación) — siempre en orden.
      const respuestas = [
        paymentHandled.text,
        ...(paymentHandled.additionalTexts ?? []),
      ].filter((texto) => texto.length > 0)
      for (const respuesta of respuestas) {
        await sendTextToJid(session, jid, respuesta).catch(
          (error: unknown) => log("payment_order_reply", error)
        )
        logWhatsAppMessageDetached({
          direction: "out",
          userId: null,
          phone,
          text: respuesta,
          meta: {
            jid,
            source: "payment_order",
            order: paymentHandled.orderId,
          },
        })
      }
      return
    }
    // Diagnóstico: el espejo salió bien pero el chat no matchea — dejar la
    // huella del teléfono resuelto para ver la forma del JID entrante.
    log(`incoming_contact_silent phone=${phone} jid=${jid}`)
    return
  }

  const text = extractText(m.message)
  const caption = extractCaption(m.message)
  const mediaInfo = extractMediaInfo(m.message)

  if (session.kind === "business") {
    // NEGOCIO con USUARIO del tenant (§4.5 2B): SOLO la intercepción de
    // «Solicito un link de pago…» (texto). Adjuntos, en silencio: el número
    // del negocio no es un asistente.
    const route = routeBusinessUserTurn({
      hasMedia: mediaInfo !== null,
      hasText: Boolean(text),
    })
    const { maybeHandlePaymentOrderText } = await import(
      "@/server/links-pago/whatsapp"
    )
    if (route === "payment_order_text") {
      const paymentHandled = await maybeHandlePaymentOrderText({
        phone,
        text: text.trim(),
        payerName: m.pushName,
      }).catch((error: unknown) => {
        log("payment_order_user_branch", error)
        return null
      })
      if (paymentHandled !== null) {
        logWhatsAppMessageDetached({
          direction: "in",
          userId: user.id,
          phone,
          text: paymentHandled.inboundText || text,
          meta: {
            jid,
            rama: "usuario_orden_pago",
            order: paymentHandled.orderId,
            tenant: session.tenantId,
          },
        })
        const respuestas = [
          paymentHandled.text,
          ...(paymentHandled.additionalTexts ?? []),
        ].filter((respuesta) => respuesta.length > 0)
        for (const respuesta of respuestas) {
          await sendTextToJid(session, jid, respuesta).catch(
            (error: unknown) => log("payment_order_reply", error)
          )
          logWhatsAppMessageDetached({
            direction: "out",
            userId: user.id,
            phone,
            text: respuesta,
            meta: {
              jid,
              source: "payment_order",
              order: paymentHandled.orderId,
              tenant: session.tenantId,
            },
          })
        }
        return
      }
    }
    // Sin intercepción: silencio. El usuario del negocio consulta por la PWA.
    return
  }

  const { assistantAttachmentsConfigured } = await import(
    "@/server/asistente/attachments"
  )
  const { enqueueAgentTurn, runWhatsAppTurn } = await import("./agent")

  // El lector de archivos (visión vía gateway) debe estar configurado en el
  // servidor: sin él el agente sigue siendo solo de texto.
  if (mediaInfo && !assistantAttachmentsConfigured()) {
    if (courtesyAllowed(session, phone)) {
      await sendTextToJid(
        session,
        jid,
        "Por ahora solo puedo leer mensajes de texto. Escríbeme tu consulta."
      ).catch(() => undefined)
    }
    return
  }

  // Sin texto, caption ni archivo no hay consulta que atender.
  if (!text && !caption && !mediaInfo) {
    if (courtesyAllowed(session, phone)) {
      await sendTextToJid(
        session,
        jid,
        "Por ahora solo puedo leer mensajes de texto. Escríbeme tu consulta."
      ).catch(() => undefined)
    }
    return
  }

  // Tipos fuera del catálogo (video, audio, stickers…): aviso una vez al día.
  if (mediaInfo && !SUPPORTED_MEDIA_TYPES.includes(mediaInfo.mimeType)) {
    if (courtesyAllowed(session, phone)) {
      await sendTextToJid(
        session,
        jid,
        "Por ahora solo puedo leer imágenes (fotos) y documentos PDF. Escríbeme tu consulta en texto."
      ).catch(() => undefined)
    }
    return
  }

  if (!allowInbound(session, phone)) return

  const socket = session.socket
  if (!socket) return

  /*
   * La SOLICITUD de orden de pago («Solicito un link de pago por $X», el
   * texto prellenado del link) también llega de un USUARIO registrado — el
   * cobrador probando su propio link, o un pagador con cuenta en el panel:
   * interceptarla AQUÍ para que el agente LLM no responda «no puedo
   * generar órdenes de pago». Solo texto; los ADJUNTOS de un usuario siguen
   * su curso normal del asistente (con pendientes vivas, secuestrar fotos
   * secuestraría uploads ajenos al módulo).
   */
  const { maybeHandlePaymentOrderText } = await import(
    "@/server/links-pago/whatsapp"
  )
  if (!mediaInfo && text) {
    const paymentHandled = await maybeHandlePaymentOrderText({
      phone,
      text: text.trim(),
      payerName: m.pushName,
    }).catch((error: unknown) => {
      log("payment_order_user_branch", error)
      return null
    })
    if (paymentHandled !== null) {
      logWhatsAppMessageDetached({
        direction: "in",
        userId: user.id,
        phone,
        text: paymentHandled.inboundText || text,
        meta: {
          jid,
          rama: "usuario_orden_pago",
          order: paymentHandled.orderId,
        },
      })
      const respuestas = [
        paymentHandled.text,
        ...(paymentHandled.additionalTexts ?? []),
      ].filter((respuesta) => respuesta.length > 0)
      for (const respuesta of respuestas) {
        await sendTextToJid(session, jid, respuesta).catch(
          (error: unknown) => log("payment_order_reply", error)
        )
        logWhatsAppMessageDetached({
          direction: "out",
          userId: user.id,
          phone,
          text: respuesta,
          meta: {
            jid,
            source: "payment_order",
            order: paymentHandled.orderId,
          },
        })
      }
      return
    }
  }

  /*
   * Adjunto del turno: bajar el archivo y guardarlo en el almacenamiento del
   * usuario (mismo `user_files` que el Asistente de la PWA). La transcripción
   * con visión NO se hace aquí: runWhatsAppTurn la reserva para los turnos
   * que no intercepta (comando o comprobante de renovación hacen su propia
   * lectura), igual que la ruta del chat web.
   */
  let attachments: import("@/server/asistente/attachments").AssistantAttachmentMeta[] = []
  if (mediaInfo) {
    let bytes: Buffer
    try {
      bytes = await downloadIncomingMedia(m, socket)
    } catch (error) {
      log("media_download", error)
      await sendTextToJid(
        session,
        jid,
        "No pude leer el archivo que enviaste (pudo expirar o pesar demasiado). Inténtalo de nuevo."
      ).catch(() => undefined)
      return
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      await sendTextToJid(
        session,
        jid,
        `El archivo supera el límite de ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB por mensaje. Escríbeme tu consulta en texto.`
      ).catch(() => undefined)
      return
    }
    try {
      const { saveUserFile } = await import("@/server/storage/user-files")
      const file = await saveUserFile({
        userId: user.id,
        kind: "attachment",
        fileName: mediaInfo.fileName ?? defaultMediaFileName(mediaInfo.mimeType),
        mimeType: mediaInfo.mimeType,
        bytes,
      })
      attachments = [
        {
          fileId: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          description: null,
        },
      ]
    } catch (error) {
      log("media_store", error)
      await sendTextToJid(
        session,
        jid,
        "No pude registrar el archivo que enviaste. Inténtalo de nuevo."
      ).catch(() => undefined)
      return
    }
  }

  const effectiveText = cleanReplyText(text || caption) || text || caption

  logWhatsAppMessageDetached({
    direction: "in",
    userId: user.id,
    phone,
    text:
      effectiveText ||
      (mediaInfo
        ? `[archivo: ${attachments[0]?.fileName ?? mediaInfo.mimeType}]`
        : ""),
    meta: { jid, media: mediaInfo?.mimeType ?? null },
  })

  // «Escribiendo…» mientras consulta: inmediato y refrescado cada 20 s
  // (WhatsApp caduca la presencia y los turnos con herramientas tardan).
  await socket.sendPresenceUpdate("composing", jid).catch(() => undefined)
  const composingTimer = setInterval(() => {
    void socket.sendPresenceUpdate("composing", jid).catch(() => undefined)
  }, 20_000)
  composingTimer.unref?.()

  try {
    // Turno encolado (convivencia Baileys ↔ agente): serializado por teléfono
    // y con tope global de concurrencia para el LLM; el socket nunca espera.
    // runWhatsAppTurn ejecuta ANTES los interceptores del chat web (comandos
    // / y comprobante de renovación), degrada sus fallos a una respuesta de
    // error (nunca silencio) y solo lo no interceptado va al modelo.
    const reply = await enqueueAgentTurn(phone, () =>
      runWhatsAppTurn({
        user: { id: user.id, username: user.username, role: user.role },
        phone,
        text: effectiveText,
        attachmentMetas: attachments,
      })
    )
    await sendTextToJid(session, jid, reply.text)
    logWhatsAppMessageDetached({
      direction: "out",
      userId: user.id,
      phone,
      text: reply.text,
      meta: { jid, source: "agent", llmUsed: reply.llmUsed },
    })
  } finally {
    clearInterval(composingTimer)
  }
}

// ---------------------------------------------------------------------------
// API pública del gateway (firmas por tenant, §4.5 2A)
// ---------------------------------------------------------------------------

export interface WhatsAppStatusInfo {
  configured: boolean
  status: WhatsAppStatus
  agentNumberMasked: string | null
  hasQr: boolean
  pairedAt: string | null
  lastDisconnectCode: number | null
  lastDisconnectAt: string | null
  lastDisconnectReason: string | null
  startedAt: string | null
}

/** Estado del gateway del tenant para la UI (sin exponer el número completo). */
export async function getWhatsAppStatus(tenantId: string): Promise<WhatsAppStatusInfo> {
  const session = sessionForTenant(tenantId)
  const declared =
    session?.agentNumber ??
    (await declaredAgentNumber(tenantId))
  const number = declared || (tenantId === LEGACY_TENANT_ID ? whatsappAgentNumber() : null)
  return {
    configured: number !== null,
    status: session?.status ?? "disabled",
    agentNumberMasked: number ? maskNumber(number) : null,
    hasQr: session?.qr != null,
    pairedAt: session?.pairedAt ?? null,
    lastDisconnectCode: session?.lastDisconnectCode ?? null,
    lastDisconnectAt: session?.lastDisconnectAt ?? null,
    lastDisconnectReason: session?.lastDisconnectReason ?? null,
    startedAt: session?.startedAt ?? null,
  }
}

/** QR vigente como data URL para pintar en el módulo; null si no hay. */
export async function getWhatsAppQrDataUrl(tenantId: string): Promise<string | null> {
  const qr = sessionForTenant(tenantId)?.qr
  if (!qr) return null
  return QRCode.toDataURL(qr, { margin: 1, width: 320 })
}

/**
 * Código de emparejamiento de 8 dígitos para vincular sin cámara (WhatsApp →
 * Dispositivos vinculados → Vincular con número de teléfono). Solo funciona
 * sin sesión ya registrada; espera hasta ~20 s a que el socket esté listo
 * (el QR es la señal de que WhatsApp pidió registro).
 */
export async function requestWhatsAppPairing(tenantId: string): Promise<string> {
  // El legado registra su sesión al boot; un negocio con número declarado se
  // auto-registra aquí (sin sesión no hay pairing que pedir).
  const live =
    sessionForTenant(tenantId) ?? (await autoRegisterTenantSession(tenantId))
  if (!live) throw new Error("whatsapp_not_configured")
  const number = live.agentNumber
  if (!number) throw new Error("whatsapp_not_configured")
  if (live.status === "open") {
    throw new Error("whatsapp_already_paired")
  }
  await ensureWhatsAppSocket(live)

  const isOpen = () => (live.status as WhatsAppStatus) === "open"
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && !live.qr && !isOpen()) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const socket = live.socket
  if (!socket) throw new Error("whatsapp_socket_not_ready")
  if (isOpen()) throw new Error("whatsapp_already_paired")
  return socket.requestPairingCode(number)
}

/**
 * Borra la sesión revocada y vuelve a crear el socket para re-vincular el
 * número (QR o código de emparejamiento). Solo procede en estado `revoked`:
 * con sesión viva o conectando sería destruir credenciales sanas.
 */
export async function resetWhatsAppSession(tenantId: string): Promise<void> {
  const session = sessionForTenant(tenantId)
  if (!session || session.status !== "revoked") throw new Error("whatsapp_not_revoked")
  // Guarda de reset (2A): el LEGADO jamás borra la carpeta de otro ni un
  // negocio borra la del legado — la carpeta es función del tenant.
  if (session.authFolder.includes("..")) throw new Error("whatsapp_folder_invalid")
  await rm(session.authFolder, { recursive: true, force: true })
  session.pairedAt = null
  session.lastDisconnectCode = null
  session.lastDisconnectReason = null
  session.status = "connecting"
  await ensureWhatsAppSocket(session)
}

/**
 * Envío para la cola de salida DEL tenant: devuelve el JID usado o lanza con
 * el motivo. El fallo es dato para `wa_outbox` (reintentos con backoff), no
 * una excepción que rompa el dispatcher.
 */
export async function sendWhatsAppText(
  tenantId: string,
  phone: string,
  text: string
): Promise<string> {
  const session = sessionForTenant(tenantId)
  if (!session) throw new Error("whatsapp_socket_not_ready")
  const jid = await jidForPhone(session, phone)
  await sendTextToJid(session, jid, text)
  return jid
}

/**
 * Envío de IMAGEN (ticket de compra PNG) para la cola de salida DEL tenant:
 * misma semántica de fallo que `sendWhatsAppText` — el motivo es dato para
 * `wa_outbox` (reintentos con backoff).
 */
export async function sendWhatsAppImage(
  tenantId: string,
  phone: string,
  imagen: WhatsAppImagenSaliente
): Promise<string> {
  const session = sessionForTenant(tenantId)
  if (!session) throw new Error("whatsapp_socket_not_ready")
  const jid = await jidForPhone(session, phone)
  await sendImageToJid(session, jid, imagen)
  return jid
}

/** ¿Ya existen credenciales de la sesión en disco? (arranque silencioso). */
async function hasStoredCredentials(session: WhatsAppSession): Promise<boolean> {
  try {
    await stat(session.authFolder)
    return true
  } catch {
    return false
  }
}

/**
 * Registra y arranca la sesión de un NEGOCIO con número declarado. Con
 * credenciales previas abre el socket directo; sin ellas la deja registrada
 * en `disabled` para que el pairing (QR/código) la pida. El legado NO entra
 * por aquí: su arranque es el del boot con el número del env.
 */
export async function startTenantSession(tenantId: string): Promise<boolean> {
  if (tenantId === LEGACY_TENANT_ID) return false
  const tenant = await findTenantById(tenantId).catch(() => null)
  if (!tenant || tenant.kind !== "business" || tenant.status !== "active") {
    return false
  }
  const number = tenant.whatsappNumber
  if (!number) return false
  const session = ensureSessionRegistered(tenantId, "business")
  session.agentNumber = number
  if (!(await hasStoredCredentials(session))) {
    // Sin credenciales no hay socket que abrir: la vinculación la pide el
    // propietario desde el módulo (QR o código de emparejamiento).
    return false
  }
  if (session.socket || session.status === "revoked") return false
  await ensureWhatsAppSocket(session)
  return true
}

/**
 * Registra la sesión del negocio si tiene número declarado (SIN abrir
 * socket): condición del pairing.
 */
async function autoRegisterTenantSession(tenantId: string): Promise<WhatsAppSession | null> {
  if (tenantId === LEGACY_TENANT_ID) return null
  const tenant = await findTenantById(tenantId).catch(() => null)
  if (!tenant || tenant.kind !== "business" || !tenant.whatsappNumber) return null
  const session = ensureSessionRegistered(tenantId, "business")
  session.agentNumber = tenant.whatsappNumber
  return session
}

/**
 * Arranque del gateway desde `instrumentation.ts`: idempotente. El legado
 * como hoy (número del env); después, cada negocio activo con número
 * declarado y credenciales, escalonado 1.5 s (jamás dos procesos con las
 * mismas llaves de Baileys: staging no arranca negocios).
 */
export async function startWhatsAppGateway(): Promise<void> {
  const agentNumber = whatsappAgentNumber()
  if (!agentNumber) {
    logInfo("whatsapp.disabled", { reason: "WHATSAPP_AGENT_NUMBER ausente" })
    return
  }
  const { startWhatsAppOutboxDispatcher } = await import("./outbox")
  startWhatsAppOutboxDispatcher()

  const session = ensureSessionRegistered(LEGACY_TENANT_ID, "legacy")
  session.agentNumber = agentNumber
  await ensureWhatsAppSocket(session)

  // Negocios (2B): escalonados tras el legado para no golpear WhatsApp a la
  // vez. Un fallo de UN negocio no corta el resto ni el arranque.
  try {
    const tenants = await listActiveTenants()
    for (const tenant of tenants) {
      if (tenant.kind !== "business" || !tenant.whatsappNumber) continue
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      void startTenantSession(tenant.id).catch((error: unknown) =>
        log(`tenant_session_start ${tenant.id}`, error)
      )
    }
  } catch (error) {
    log("tenant_sessions_boot", error)
  }
}
