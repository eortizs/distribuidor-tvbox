import { Boom } from "@hapi/boom"
import { rm } from "node:fs/promises"
import QRCode from "qrcode"
import NodeCache from "@cacheable/node-cache"
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  proto,
  type CacheStore,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys"
import pino from "pino"

import {
  findUserByWhatsAppPhone,
  logWhatsAppMessageDetached,
} from "./service"
import { enqueueAgentTurn, runWhatsAppAgent } from "./agent"
import { canonicalWhatsAppDigits, whatsappAgentNumber } from "./config"

/*
 * Gateway WhatsApp con Baileys: el número del agente IA se vincula como
 * dispositivo enlazado (mismo mecanismo de WhatsApp Web) y vive en el mismo
 * proceso Next.js, arrancado desde `src/instrumentation.ts` como los
 * schedulers. La sesión persiste en `storage/whatsapp-session/` (ignorada
 * por git: contiene llaves criptográficas de larga vida).
 *
 * Contratos:
 * - Un deploy (`pm2 reload`) corta el socket: reconecta solo con las
 *   credenciales persistidas; los salientes quedan en `wa_outbox` y salen
 *   al reconectar, y WhatsApp entrega los entrantes atrasados al volver.
 * - `loggedOut` (dispositivo desvinculado desde el teléfono) NO reconecta:
 *   queda en estado `revoked` y el admin re-vincula desde el módulo.
 * - Solo se conversa con números registrados en `users.whatsapp_phone`;
 *   grupos, broadcast y newsletters se ignoran por completo.
 * - JIDs LID (cuentas migradas de WhatsApp) se resuelven a teléfono con el
 *   LIDMappingStore del signal repository; sin resolución, se ignoran con
 *   una línea de log (limitación conocida v1).
 */

const AUTH_FOLDER = "storage/whatsapp-session"
const RECONNECT_BASE_MS = 3_000
const RECONNECT_MAX_MS = 60_000
/** Mensajes offline más viejos que esto no se responden (backfill antiguo). */
const STALE_MESSAGE_MS = 6 * 60 * 60 * 1000
/** Mensajes guardados para re-encrypt en reintentos (getMessage). */
const MESSAGE_STORE_MAX = 500
/** Límite entrante por número: 20 mensajes por minuto. */
const INBOUND_RATE_MAX = 20
const INBOUND_RATE_WINDOW_MS = 60_000
/** Respuestas de cortesía («no registrado», «solo texto»): 1 por 24 h. */
const COURTESY_WINDOW_MS = 24 * 60 * 60 * 1000

type WhatsAppStatus =
  | "disabled"
  | "connecting"
  | "open"
  | "close"
  | "revoked"

interface WhatsAppGatewayState {
  socket: WASocket | null
  status: WhatsAppStatus
  qr: string | null
  pairedAt: string | null
  lastDisconnectCode: number | null
  lastDisconnectAt: string | null
  lastDisconnectReason: string | null
  startedAt: string | null
  restarting: boolean
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectDelayMs: number
  /** teléfono → JID resuelto con onWhatsApp (evita la consulta por envío). */
  jidCache: Map<string, { jid: string; at: number }>
  /** Plano de mensajes recientes para reintentos de descifrado. */
  messageStore: Map<string, proto.IMessage>
  inboundBuckets: Map<string, { count: number; resetAt: number }>
  courtesyAt: Map<string, number>
}

const globalForWhatsApp = globalThis as typeof globalThis & {
  __umeWhatsappGateway?: WhatsAppGatewayState
}

function state(): WhatsAppGatewayState {
  const existing = globalForWhatsApp.__umeWhatsappGateway
  if (existing) return existing
  const created: WhatsAppGatewayState = {
    socket: null,
    status: "disabled",
    qr: null,
    pairedAt: null,
    lastDisconnectCode: null,
    lastDisconnectAt: null,
    lastDisconnectReason: null,
    startedAt: null,
    restarting: false,
    reconnectTimer: null,
    reconnectDelayMs: RECONNECT_BASE_MS,
    jidCache: new Map(),
    messageStore: new Map(),
    inboundBuckets: new Map(),
    courtesyAt: new Map(),
  }
  globalForWhatsApp.__umeWhatsappGateway = created
  return created
}

const logger = pino({ level: "silent" })

function log(context: string, error?: unknown): void {
  const line = error
    ? `whatsapp: ${context}: ${error instanceof Error ? error.message : String(error)}`
    : `whatsapp: ${context}`
  console.error(JSON.stringify({ ts: new Date().toISOString(), error: line }))
}

function logInfo(event: string, extra: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }))
}

function extractText(message: object | null | undefined): string {
  if (!message || typeof message !== "object") return ""
  const anyMessage = message as Record<string, unknown>
  const conversation = anyMessage.conversation
  if (typeof conversation === "string" && conversation.trim()) {
    return conversation.trim()
  }
  const extended = anyMessage.extendedTextMessage as
    | Record<string, unknown>
    | undefined
  const text = extended?.text
  if (typeof text === "string" && text.trim()) {
    return text.trim()
  }
  return ""
}

/** Quita decoraciones de WhatsApp (negritas, emojis de viñeta, espacios). */
function cleanReplyText(text: string): string {
  return text.replace(/\*/g, "").trim()
}

/** Contador de reintentos de envío (sobrevive reinicios de socket). */
const msgRetryCounterCache = new NodeCache() as CacheStore

/**
 * Resuelve el teléfono (dígitos) del remitente desde el JID. Los JIDs
 * `@s.whatsapp.net` traen el número directamente; los `@lid` se resuelven
 * con el mapa LID→PN del signal repository (Baileys lo alimenta durante la
 * sesión). Devuelve null si no se pudo resolver.
 */
async function phoneFromJid(jid: string): Promise<string | null> {
  const normalized = jidNormalizedUser(jid)
  if (normalized.endsWith("@s.whatsapp.net")) {
    const digits = normalized.split("@")[0]?.replace(/\D+/g, "") || null
    return digits ? canonicalWhatsAppDigits(digits) : null
  }
  if (normalized.endsWith("@lid")) {
    const socket = state().socket
    if (!socket) return null
    try {
      const pn = await socket.signalRepository.lidMapping.getPNForLID(normalized)
      if (!pn) return null
      // getPNForLID puede devolver el JID crudo con sufijo de dispositivo
      // («521…:0@s.whatsapp.net»): hay que normalizarlo antes de extraer
      // dígitos o el «:0» se cuela como un cero final que rompe el match.
      const pnJid = jidNormalizedUser(pn)
      const digits = canonicalWhatsAppDigits(pnJid.split("@")[0]?.replace(/\D+/g, "") ?? "")
      return digits || null
    } catch (error) {
      log(`lid_resolve ${jid}`, error)
      return null
    }
  }
  return null
}

function allowInbound(phone: string): boolean {
  const buckets = state().inboundBuckets
  const now = Date.now()
  if (buckets.size > 1000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
  }
  const bucket = buckets.get(phone)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(phone, { count: 1, resetAt: now + INBOUND_RATE_WINDOW_MS })
    return true
  }
  bucket.count += 1
  return bucket.count <= INBOUND_RATE_MAX
}

function courtesyAllowed(phone: string): boolean {
  const map = state().courtesyAt
  const last = map.get(phone) ?? 0
  if (Date.now() - last < COURTESY_WINDOW_MS) return false
  map.set(phone, Date.now())
  if (map.size > 1000) {
    for (const [key, at] of map) {
      if (Date.now() - at > COURTESY_WINDOW_MS) map.delete(key)
    }
  }
  return true
}

async function handleIncomingMessage(m: WAMessage): Promise<void> {
  const current = state()
  if (!m.key || m.key.fromMe || !m.message) return
  const jid = m.key.remoteJid
  if (!jid) return
  if (isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return

  // Guarda el plano para reintentos de descifrado (getMessage), con tope.
  if (m.key.id) {
    if (current.messageStore.size > MESSAGE_STORE_MAX) {
      const firstKey = current.messageStore.keys().next().value
      if (firstKey) current.messageStore.delete(firstKey)
    }
    current.messageStore.set(`${jid}:${m.key.id}`, m.message)
  }

  // Backfill antiguo (colas de días) no se responde.
  const tsSeconds = m.messageTimestamp
    ? typeof m.messageTimestamp === "number"
      ? m.messageTimestamp
      : Number(m.messageTimestamp)
    : 0
  if (tsSeconds > 0 && Date.now() - tsSeconds * 1000 > STALE_MESSAGE_MS) return

  const phone = await phoneFromJid(jid)
  if (!phone) {
    log(`incoming_unresolvable_jid ${jid}`)
    return
  }

  const user = await findUserByWhatsAppPhone(phone)
  if (!user) {
    // Diagnóstico: el espejo salió bien pero el chat no matchea — dejar la
    // huella del teléfono resuelto para ver la forma del JID entrante.
    log(`incoming_unregistered phone=${phone} jid=${jid}`)
    if (courtesyAllowed(phone)) {
      await sendTextToJid(
        jid,
        "Este número no está registrado en el panel Distribuidor TVBox. " +
          "Pide al administrador que registre tu WhatsApp para usar el agente."
      ).catch(() => undefined)
    }
    return
  }

  const text = extractText(m.message)
  if (!text) {
    if (courtesyAllowed(phone)) {
      await sendTextToJid(
        jid,
        "Por ahora solo puedo leer mensajes de texto. Escríbeme tu consulta."
      ).catch(() => undefined)
    }
    return
  }

  if (!allowInbound(phone)) return

  logWhatsAppMessageDetached({
    direction: "in",
    userId: user.id,
    phone,
    text,
    meta: { jid },
  })

  const socket = current.socket
  if (!socket) return

  // «Escribiendo…» mientras consulta: inmediato y refrescado cada 20 s
  // (WhatsApp caduca la presencia y los turnos con herramientas tardan).
  await socket.sendPresenceUpdate("composing", jid).catch(() => undefined)
  const composingTimer = setInterval(() => {
    void socket.sendPresenceUpdate("composing", jid).catch(() => undefined)
  }, 20_000)
  composingTimer.unref?.()

  try {
    // Turno encolado (convivencia Baileys ↔ agente): serializado por teléfono
    // y con tope global de concurrencia; el socket nunca espera al LLM.
    let reply = await enqueueAgentTurn(phone, () =>
      runWhatsAppAgent(
        { id: user.id, username: user.username, role: user.role },
        phone,
        cleanReplyText(text) || text
      )
    )
    if (!reply) {
      reply = {
        text: "El agente está atendiendo varios chats a la vez; inténtalo de nuevo en un momento.",
        llmUsed: false,
      }
    }
    await sendTextToJid(jid, reply.text)
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

/** Envía texto a un JID concreto (ya resuelto), fallando si no hay socket. */
async function sendTextToJid(jid: string, text: string): Promise<void> {
  const socket = state().socket
  if (!socket) throw new Error("whatsapp_socket_not_ready")
  await socket.sendMessage(jid, { text })
}

/**
 * Resuelve el JID vigente del teléfono (WhatsApp puede mapear cuentas a
 * LIDs) con caché de 24 h; lanza si el número no está en WhatsApp.
 */
async function jidForPhone(phone: string): Promise<string> {
  const current = state()
  const cached = current.jidCache.get(phone)
  if (cached && Date.now() - cached.at < COURTESY_WINDOW_MS) return cached.jid

  const socket = current.socket
  if (!socket) throw new Error("whatsapp_socket_not_ready")
  const result = await socket.onWhatsApp(phone)
  const match = result?.[0]
  if (!match?.exists) throw new Error(`whatsapp_number_missing:${phone}`)
  current.jidCache.set(phone, { jid: match.jid, at: Date.now() })
  return match.jid
}

/**
 * Envío para la cola de salida: devuelve el JID usado o lanza con el motivo.
 * El fallo es dato para `wa_outbox` (reintentos con backoff), no una
 * excepción que rompa el dispatcher.
 */
export async function sendWhatsAppText(
  phone: string,
  text: string
): Promise<string> {
  const jid = await jidForPhone(phone)
  await sendTextToJid(jid, text)
  return jid
}

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

function maskNumber(digits: string): string {
  if (digits.length < 6) return "•••"
  return `${digits.slice(0, 3)}•••${digits.slice(-3)}`
}

/** Estado del gateway para la UI admin (sin exponer el número completo). */
export function getWhatsAppStatus(): WhatsAppStatusInfo {
  const current = state()
  const agentNumber = whatsappAgentNumber()
  return {
    configured: agentNumber !== null,
    status: current.status,
    agentNumberMasked: agentNumber ? maskNumber(agentNumber) : null,
    hasQr: current.qr !== null,
    pairedAt: current.pairedAt,
    lastDisconnectCode: current.lastDisconnectCode,
    lastDisconnectAt: current.lastDisconnectAt,
    lastDisconnectReason: current.lastDisconnectReason,
    startedAt: current.startedAt,
  }
}

/** QR vigente como data URL para pintar en el módulo admin; null si no hay. */
export async function getWhatsAppQrDataUrl(): Promise<string | null> {
  const qr = state().qr
  if (!qr) return null
  return QRCode.toDataURL(qr, { margin: 1, width: 320 })
}

/**
 * Código de emparejamiento de 8 dígitos para vincular el número del agente
 * sin cámara (WhatsApp → Dispositivos vinculados → Vincular con número de
 * teléfono). Solo funciona sin sesión ya registrada; espera hasta ~20 s a
 * que el socket esté listo (el QR es la señal de que WhatsApp pidió
 * registro).
 */
export async function requestWhatsAppPairing(): Promise<string> {
  const agentNumber = whatsappAgentNumber()
  if (!agentNumber) throw new Error("whatsapp_not_configured")
  if (getWhatsAppStatus().status === "open") throw new Error("whatsapp_already_paired")
  await ensureWhatsAppSocket()

  const deadline = Date.now() + 20_000
  while (
    Date.now() < deadline &&
    !state().qr &&
    getWhatsAppStatus().status !== "open"
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const socket = state().socket
  if (!socket) throw new Error("whatsapp_socket_not_ready")
  if (getWhatsAppStatus().status === "open") throw new Error("whatsapp_already_paired")
  return socket.requestPairingCode(agentNumber)
}

/** Crea el socket Baileys (una sola vez por proceso); no reconecta solos. */
async function ensureWhatsAppSocket(): Promise<void> {
  const current = state()
  if (current.socket || current.status === "revoked") return
  if (current.restarting) return
  current.restarting = true

  try {
    // `useMultiFileAuthState` es una utilidad de Baileys (no un hook de
    // React): el nombre coincide y el linter de hooks marca falso positivo.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
    // Versión del protocolo con tope de tiempo: sin ella un GitHub colgado
    // retrasaría el arranque del servidor hasta el timeout por defecto.
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
      msgRetryCounterCache,
      getMessage: async (key) => {
        return current.messageStore.get(`${key.remoteJid}:${key.id}`)
      },
    })

    current.socket = socket
    current.status = "connecting"
    if (!current.startedAt) current.startedAt = new Date().toISOString()

    socket.ev.on("creds.update", saveCreds)

    socket.ev.on("connection.update", (update) => {
      void handleConnectionUpdate(update).catch((error: unknown) =>
        log("connection_update", error)
      )
    })

    socket.ev.on("messages.upsert", (event) => {
      if (event.type !== "notify") return
      for (const message of event.messages) {
        void handleIncomingMessage(message).catch((error: unknown) =>
          log("incoming", error)
        )
      }
    })

    logInfo("whatsapp.socket_created", { registered: auth.creds.registered })
  } catch (error) {
    // Creación fallida (auth corrupta, disco, red): registrar, marcar estado
    // y reagendar en vez de propagar — el servidor nunca depende del gateway.
    current.socket = null
    current.status = "close"
    current.lastDisconnectReason = error instanceof Error ? error.message : String(error)
    current.lastDisconnectAt = new Date().toISOString()
    log("socket_create", error)
    scheduleReconnect()
  } finally {
    current.restarting = false
  }
}

async function handleConnectionUpdate(update: {
  connection?: string
  qr?: string
  lastDisconnect?: { error?: unknown }
}): Promise<void> {
  const current = state()

  if (update.qr) {
    current.qr = update.qr
    logInfo("whatsapp.qr_issued")
  }

  if (update.connection === "open") {
    current.qr = null
    current.status = "open"
    current.pairedAt = current.pairedAt ?? new Date().toISOString()
    current.reconnectDelayMs = RECONNECT_BASE_MS
    logInfo("whatsapp.connected")
    return
  }

  if (update.connection === "close") {
    current.socket = null
    const boom = update.lastDisconnect?.error as Boom | undefined
    const statusCode = boom?.output?.statusCode ?? null
    current.lastDisconnectCode = statusCode
    current.lastDisconnectAt = new Date().toISOString()
    current.lastDisconnectReason = boom?.output?.payload?.message ?? null

    if (statusCode === DisconnectReason.loggedOut) {
      // Desvinculado desde el teléfono: no reconecta en bucle; el admin
      // re-vincula desde el módulo (borrando la sesión vieja).
      current.status = "revoked"
      current.qr = null
      logInfo("whatsapp.revoked", { status_code: statusCode })
      return
    }

    current.status = "close"
    scheduleReconnect()
    return
  }
}

/** Reconexión con backoff (deploy, corte de red, reinicio del servidor). */
function scheduleReconnect(): void {
  const current = state()
  if (current.reconnectTimer) return
  const delay = current.reconnectDelayMs
  current.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS)
  const timer = setTimeout(() => {
    current.reconnectTimer = null
    void ensureWhatsAppSocket().catch((error: unknown) => {
      log("reconnect", error)
      scheduleReconnect()
    })
  }, delay)
  timer.unref?.()
  current.reconnectTimer = timer
}

/**
 * Borra la sesión revocada y vuelve a crear el socket para re-vincular el
 * número del agente (QR o código de emparejamiento). Solo procede en estado
 * `revoked`: con sesión viva o conectando sería destruir credenciales sanas.
 */
export async function resetWhatsAppSession(): Promise<void> {
  const current = state()
  if (current.status !== "revoked") throw new Error("whatsapp_not_revoked")
  await rm(AUTH_FOLDER, { recursive: true, force: true })
  current.pairedAt = null
  current.lastDisconnectCode = null
  current.lastDisconnectReason = null
  current.status = "connecting"
  await ensureWhatsAppSocket()
}

/**
 * Arranque del gateway desde `instrumentation.ts`: idempotente. Sin número
 * de agente configurado no hace nada (módulo deshabilitado).
 */
export async function startWhatsAppGateway(): Promise<void> {
  const agentNumber = whatsappAgentNumber()
  if (!agentNumber) {
    logInfo("whatsapp.disabled", { reason: "WHATSAPP_AGENT_NUMBER ausente" })
    return
  }
  const { startWhatsAppOutboxDispatcher } = await import("./outbox")
  startWhatsAppOutboxDispatcher()
  await ensureWhatsAppSocket()
}
