import { Client } from "pg"

import { pool, type PoolClientLike } from "@/server/db"

/**
 * Bus de invalidación en tiempo real.
 *
 * Los escritores publican eventos mínimos (kind + ids, nunca documentos ni
 * datos de negocio) dentro de la misma transacción que la mutación: Postgres
 * solo entrega `pg_notify` tras el COMMIT, así que jamás se notifica una
 * escritura revertida. El endpoint `/api/realtime` (SSE) se suscribe y
 * reenvía a cada sesión conectada, ya filtrada por su alcance.
 *
 * El fan-out entre procesos va por LISTEN/NOTIFY sobre un cliente dedicado
 * (no del pool): sobrevive a pm2 cluster, a `pm2 reload` y a varios procesos
 * Node apuntando a la misma base.
 */

export type RealtimeKind =
  | "entity"
  | "mp_order"
  | "expenses"
  | "users"
  | "prefs"
  | "notifications"
  | "alerts"
  | "assistant"

export interface RealtimeEvent {
  kind: RealtimeKind
  /** Id del recurso tocado (entidad, orden de MP o usuario destino). */
  entityId?: string
  /**
   * Cliente FlujoTV renovado (solo `mp_order`): permite a las pantallas de
   * clientes refrescar SOLO esa fila en vivo en vez de recargar el listado
   * completo (lento y, con el snapshot cacheado, devolvería el vencimiento
   * viejo pisando la fila ya actualizada).
   */
  userName?: string
  /** Estado nuevo de la orden tras la mutación (solo `mp_order`). */
  status?: string
  /** Usuario propietario del dato (dynamicProperties.distribuidorId / user_id). */
  distribuidorId?: string | null
  /** Reseller FlujoTV ligado al dato, cuando aplica (entidad Cuenta). */
  distribuidor?: string | null
  at: string
}

const CHANNEL = "realtime"
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

type Listener = (event: RealtimeEvent) => void

interface RealtimeState {
  handlers: Set<Listener>
  client: Client | null
}

const globalForRealtime = globalThis as typeof globalThis & {
  __umeRealtime?: RealtimeState
}

function state(): RealtimeState {
  const existing = globalForRealtime.__umeRealtime
  if (existing) return existing
  const created: RealtimeState = { handlers: new Set(), client: null }
  globalForRealtime.__umeRealtime = created
  return created
}

function logError(context: string, error: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `realtime: ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
}

function parsePayload(raw: string | undefined): RealtimeEvent | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) return null
    const candidate = parsed as RealtimeEvent
    if (
      candidate.kind !== "entity" &&
      candidate.kind !== "mp_order" &&
      candidate.kind !== "expenses" &&
      candidate.kind !== "users" &&
      candidate.kind !== "prefs" &&
      candidate.kind !== "notifications" &&
      candidate.kind !== "alerts" &&
      candidate.kind !== "assistant"
    ) {
      return null
    }
    return candidate
  } catch {
    return null
  }
}

/**
 * Listener dedicado: un único cliente por proceso en LISTEN. Global en
 * `globalThis` para que el hot reload de desarrollo no acumule conexiones.
 */
function ensureListener(): void {
  const current = state()
  if (current.client || !process.env.DATABASE_URL) return

  let backoff = RECONNECT_BASE_MS

  const open = (): void => {
    // Otro intento pudo ganar la carrera mientras esperábamos el backoff.
    if (current.client) return

    const client = new Client({ connectionString: process.env.DATABASE_URL })
    current.client = client

    let dead = false
    const die = (cause: unknown): void => {
      if (dead) return
      dead = true
      if (current.client === client) current.client = null
      client.removeAllListeners()
      void client.end().catch(() => undefined)
      if (cause) logError("listener_lost", cause)
      const timer = setTimeout(open, backoff)
      timer.unref()
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS)
    }

    client.on("notification", (message) => {
      if (message.channel !== CHANNEL) return
      const event = parsePayload(message.payload)
      if (!event) return
      for (const handler of current.handlers) {
        try {
          handler(event)
        } catch (error) {
          // Un listener roto no debe cortar el fan-out al resto.
          logError("handler_failed", error)
        }
      }
    })
    client.on("error", die)
    client.on("end", () => die(undefined))

    client
      .connect()
      .then(() => client.query(`LISTEN ${CHANNEL}`))
      .then(() => {
        backoff = RECONNECT_BASE_MS
      })
      .catch(die)
  }

  open()
}

/**
 * Publica un evento dentro de la transacción `executor` (o de su sesión
 * autocommit): si la escritura revierte, el NOTIFY no se entrega. Fallos del
 * canal son mejor esfuerzo y no revierten el negocio.
 */
export async function publishRealtime(
  executor: PoolClientLike,
  event: Omit<RealtimeEvent, "at">
): Promise<void> {
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() })
  try {
    await executor.query("SELECT pg_notify($1, $2)", [CHANNEL, payload])
  } catch (error) {
    logError("publish_failed", error)
  }
}

/** Igual que `publishRealtime`, sobre el pool y sin esperar el resultado. */
export function publishRealtimeDetached(
  event: Omit<RealtimeEvent, "at">
): void {
  void publishRealtime(pool, event).catch(() => undefined)
}

/**
 * Suscripción en proceso para el endpoint SSE. Devuelve la función de
 * desregistro; arranca el listener compartido la primera vez.
 */
export function subscribeRealtime(handler: Listener): () => void {
  const current = state()
  current.handlers.add(handler)
  ensureListener()
  return () => {
    current.handlers.delete(handler)
  }
}
