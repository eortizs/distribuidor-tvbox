import NodeCache from "@cacheable/node-cache"
import {
  jidNormalizedUser,
  type CacheStore,
  type proto,
  type WASocket,
} from "@whiskeysockets/baileys"

import { canonicalWhatsAppDigits } from "./config.ts"
import { log } from "./log.ts"

/*
 * Sesión WhatsApp POR TENANT (§4.5 2A del plan): el tipo y las primitivas
 * que antes leían el estado global del gateway ahora reciben la sesión.
 * Toda función es mecánica de SU sesión — el registro global y el ciclo de
 * vida viven en gateway.ts. Este módulo NO importa el resto del canal
 * (solo config/log): las pruebas de Node lo cargan directo.
 */

/** Límite entrante por número: 20 mensajes por minuto. */
const INBOUND_RATE_MAX = 20
const INBOUND_RATE_WINDOW_MS = 60_000
/** Respuestas de cortesía («solo texto»): 1 por 24 h. */
const COURTESY_WINDOW_MS = 24 * 60 * 60 * 1000

export type WhatsAppStatus =
  | "disabled"
  | "connecting"
  | "open"
  | "close"
  | "revoked"

/**
 * Carpeta de credenciales de la sesión. El LEGADO NO SE MUOVE
 * (`storage/whatsapp-session`, llaves vivas de TVBox); los negocios llevan
 * SU id (inmutable y seguro en rutas; jamás el slug, que es cambiable).
 */
export const LEGACY_AUTH_FOLDER = "storage/whatsapp-session"

export function authFolderForTenant(tenantId: string, kind: "legacy" | "business"): string {
  // El LEGADO conserva su carpeta histórica (kind lo decide el gateway con
  // el id del tenant legado); un negocio lleva SU id (inmutable y seguro en
  // rutas; jamás el slug, que es cambiable).
  if (kind === "legacy") return LEGACY_AUTH_FOLDER
  return `storage/whatsapp-sessions/${tenantId}`
}

export interface WhatsAppSession {
  tenantId: string
  /** legacy = panel TVBox (agente LLM + clientes); business = solo cobros. */
  kind: "legacy" | "business"
  authFolder: string
  /** Número declarado del negocio (negocios); null = el del env (legado). */
  agentNumber: string | null
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
  /** Contador de reintentos de envío, POR sesión (Baileys lo muta). */
  msgRetryCounterCache: CacheStore
}

export function createWhatsAppSession(input: {
  tenantId: string
  kind: "legacy" | "business"
  /** Número canónico declarado; null = resolvedor por env (legado). */
  agentNumber?: string | null
}): WhatsAppSession {
  return {
    tenantId: input.tenantId,
    kind: input.kind,
    authFolder: authFolderForTenant(input.tenantId, input.kind),
    agentNumber: input.agentNumber ?? null,
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
    reconnectDelayMs: 3_000,
    jidCache: new Map(),
    messageStore: new Map(),
    inboundBuckets: new Map(),
    courtesyAt: new Map(),
    msgRetryCounterCache: new NodeCache() as CacheStore,
  }
}

/** Estado del tipo WhatsAppStatusInfo sin exponer el número completo. */
export function maskNumber(digits: string): string {
  if (digits.length < 6) return "•••"
  return `${digits.slice(0, 3)}•••${digits.slice(-3)}`
}

/**
 * Resuelve el teléfono (dígitos) del remitente desde el JID para ESTA
 * sesión. Los JIDs `@s.whatsapp.net` traen el número directamente; los
 * `@lid` se resuelven con el mapa LID→PN del signal repository de la sesión
 * (Baileys lo alimenta durante la sesión). Devuelve null si no se pudo.
 */
export async function phoneFromJid(
  session: WhatsAppSession,
  jid: string
): Promise<string | null> {
  const normalized = jidNormalizedUser(jid)
  if (normalized.endsWith("@s.whatsapp.net")) {
    const digits = normalized.split("@")[0]?.replace(/\D+/g, "") || null
    return digits ? canonicalWhatsAppDigits(digits) : null
  }
  if (normalized.endsWith("@lid")) {
    const socket = session.socket
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

/** Límite entrante por número, con bucket POR sesión. */
export function allowInbound(session: WhatsAppSession, phone: string): boolean {
  const buckets = session.inboundBuckets
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

/** Cortesía («solo texto»): 1 por 24 h POR sesión. */
export function courtesyAllowed(session: WhatsAppSession, phone: string): boolean {
  const map = session.courtesyAt
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

/** «Escribiendo…» mientras la rama de clientes procesa (escaneo ~25 s). */
export async function withClientComposing<T>(
  session: WhatsAppSession,
  jid: string,
  job: () => Promise<T>
): Promise<T> {
  const socket = session.socket
  if (!socket) return job()
  await socket.sendPresenceUpdate("composing", jid).catch(() => undefined)
  const timer = setInterval(() => {
    void socket.sendPresenceUpdate("composing", jid).catch(() => undefined)
  }, 20_000)
  timer.unref?.()
  try {
    return await job()
  } finally {
    clearInterval(timer)
  }
}

/** Envía texto a un JID concreto (ya resuelto), fallando si no hay socket. */
export async function sendTextToJid(
  session: WhatsAppSession,
  jid: string,
  text: string
): Promise<void> {
  const socket = session.socket
  if (!socket) throw new Error("whatsapp_socket_not_ready")
  await socket.sendMessage(jid, { text })
}

/**
 * Resuelve el JID vigente del teléfono (WhatsApp puede mapear cuentas a
 * LIDs) con caché de 24 h; lanza si el número no está en WhatsApp.
 */
export async function jidForPhone(
  session: WhatsAppSession,
  phone: string
): Promise<string> {
  const cached = session.jidCache.get(phone)
  if (cached && Date.now() - cached.at < COURTESY_WINDOW_MS) return cached.jid

  const socket = session.socket
  if (!socket) throw new Error("whatsapp_socket_not_ready")
  const result = await socket.onWhatsApp(phone)
  const match = result?.[0]
  if (!match?.exists) throw new Error(`whatsapp_number_missing:${phone}`)
  session.jidCache.set(phone, { jid: match.jid, at: Date.now() })
  return match.jid
}
