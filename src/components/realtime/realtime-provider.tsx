"use client"

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"

export type RealtimeKind =
  | "entity"
  | "mp_order"
  | "expenses"
  | "users"
  | "prefs"
  | "notifications"
  | "alerts"

export type RealtimeStatus = "connecting" | "live" | "offline"

export interface RealtimeMessage {
  kind: RealtimeKind
  entityId?: string
  /** Cliente FlujoTV renovado (solo `mp_order`): para refrescar solo su fila. */
  userName?: string
  /** Estado nuevo de la orden tras la mutación (solo `mp_order`). */
  status?: string
  distribuidorId?: string | null
  distribuidor?: string | null
  at: string
}

type Listener = (message: RealtimeMessage) => void

interface RealtimeContextValue {
  status: RealtimeStatus
  subscribe: (listener: Listener) => () => void
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null)

/**
 * Coalescencia de refrescos: varios eventos en ráfaga (p. ej. una renovación
 * que escribe orden + entidad) producen un único `router.refresh()`.
 */
const REFRESH_DEBOUNCE_MS = 300

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

const KINDS: RealtimeKind[] = [
  "entity",
  "mp_order",
  "expenses",
  "users",
  "prefs",
  "notifications",
  "alerts",
]

function parseMessage(event: Event): RealtimeMessage | null {
  const data = (event as MessageEvent).data
  if (typeof data !== "string") return null
  try {
    const parsed = JSON.parse(data) as unknown
    if (typeof parsed !== "object" || parsed === null) return null
    const candidate = parsed as RealtimeMessage
    return KINDS.includes(candidate.kind) ? candidate : null
  } catch {
    return null
  }
}

/**
 * Canal único de tiempo real del dashboard: una sola conexión SSE por pestaña.
 * Al recibir eventos válidos refresca el RSC de la ruta actual (coalescido y
 * solo con la pestaña visible); las vistas que se alimentan de API routes se
 * suscriben con `useRealtimeEvent`. El servidor ya filtró por alcance, así
 * que todo evento recibido es relevante para esta sesión.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<RealtimeStatus>("connecting")
  const listenersRef = useRef(new Set<Listener>())
  const refreshTimerRef = useRef<number | null>(null)

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    let source: EventSource | null = null
    let reconnectTimer: number | null = null
    let backoff = RECONNECT_BASE_MS
    /** false solo hasta la primera apertura: la reconexión pide catch-up. */
    let everOpened = false

    const scheduleRefresh = (): void => {
      if (document.hidden) return
      if (refreshTimerRef.current !== null) return
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        router.refresh()
      }, REFRESH_DEBOUNCE_MS)
    }

    const connect = (): void => {
      source = new EventSource("/api/realtime")

      source.addEventListener("open", () => {
        backoff = RECONNECT_BASE_MS
        setStatus("live")
        // Una desconexión pudo tragarse eventos: al volver, sincronizar.
        if (everOpened) scheduleRefresh()
        everOpened = true
      })

      source.addEventListener("change", (event) => {
        const message = parseMessage(event)
        if (!message) return
        for (const listener of listenersRef.current) {
          try {
            listener(message)
          } catch {
            // Un listener roto no corta el aviso al resto de vistas.
          }
        }
        scheduleRefresh()
      })

      source.addEventListener("error", () => {
        setStatus(
          source && source.readyState === EventSource.CLOSED
            ? "offline"
            : "connecting"
        )
        // CONNECTING: el navegador reintenta solo. CLOSED (fatal, p. ej. 401
        // tras expirar la sesión): reintento manual con backoff acotado.
        if (source && source.readyState === EventSource.CLOSED) {
          source.close()
          reconnectTimer = window.setTimeout(connect, backoff)
          backoff = Math.min(backoff * 2, RECONNECT_MAX_MS)
        }
      })
    }

    connect()

    const onVisibility = (): void => {
      if (document.hidden) return
      // Eventos ignorados mientras estuvo oculta: refresco directo al volver.
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      router.refresh()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [router])

  const value = useMemo(
    () => ({ status, subscribe }),
    [status, subscribe]
  )

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}
