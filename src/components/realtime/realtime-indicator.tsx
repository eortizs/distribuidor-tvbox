"use client"

import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/reui/badge"
import {
  useRealtimeStatus,
} from "@/hooks/use-realtime"
import { cn } from "cn"

/**
 * Aviso de estado del canal en tiempo real. En silencio cuando todo va bien
 * («live» es el estado esperado, no hace falta anunciarlo); solo aparece
 * mientras la conexión está caída o reconectando, y desaparece al volver.
 * Se oculta en el primer arranque: un «reconectando» antes de haber
 * conectado alguna vez sería ruido.
 */
export function RealtimeIndicator() {
  const status = useRealtimeStatus()
  const everLiveRef = useRef(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (status === "live") everLiveRef.current = true
    setVisible(everLiveRef.current && status !== "live")
  }, [status])

  if (!visible) return null

  return (
    <Badge
      variant="warning-light"
      size="default"
      className="gap-1.5"
      role="status"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-warning",
          status === "connecting" && "animate-pulse"
        )}
      />
      {status === "connecting" ? "Reconectando…" : "Sin conexión"}
    </Badge>
  )
}
