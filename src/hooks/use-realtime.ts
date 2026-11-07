"use client"

import { useContext, useEffect, useRef } from "react"

import {
  RealtimeContext,
  type RealtimeKind,
  type RealtimeStatus,
} from "@/components/realtime/realtime-provider"

/**
 * Suscripción a eventos de tiempo real para vistas que se alimentan de API
 * routes (un `router.refresh()` no alcanza a refetchearlas). El callback se
 * ignora con la pestaña oculta: al volver, el provider refresca por
 * `visibilitychange`. Los arrays se leen vía refs, así que el efecto solo se
 * rearma si cambia la conexión, no en cada render.
 */
export function useRealtimeEvent(
  kinds: RealtimeKind[],
  callback: () => void
): void {
  const context = useContext(RealtimeContext)
  const kindsRef = useRef(kinds)
  const callbackRef = useRef(callback)

  useEffect(() => {
    kindsRef.current = kinds
    callbackRef.current = callback
  }, [kinds, callback])

  useEffect(() => {
    if (!context) return
    return context.subscribe((message) => {
      if (!kindsRef.current.includes(message.kind)) return
      if (document.hidden) return
      callbackRef.current()
    })
  }, [context])
}

/** Estado actual del canal (para el indicador de la cabecera). */
export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext)?.status ?? "connecting"
}
