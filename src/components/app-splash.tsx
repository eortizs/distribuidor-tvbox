"use client"

import { useEffect, useState } from "react"

import { cn } from "cn"
import { MascotaLogo } from "@/components/mascota-logo"
import { Spinner } from "@/components/ui/spinner"
import { TvboxWordmark } from "@/components/tvbox-wordmark"

/** Tiempo mínimo en pantalla: evita que el splash parpadee en cargas rápidas. */
const MIN_VISIBLE_MS = 800
/** Duración del desvanecido de salida. */
const FADE_MS = 300
/** Red de seguridad: si nada confirma que la app está lista, el splash se retira solo. */
const MAX_VISIBLE_MS = 5000

export function AppSplash() {
  const [phase, setPhase] = useState<"visible" | "leaving" | "hidden">("visible")

  useEffect(() => {
    const startedAt = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    let leaving = false
    let seenLoading = document.querySelector("[data-app-loading]") !== null

    const leave = () => {
      if (leaving) return
      leaving = true
      timer = setTimeout(() => {
        setPhase("leaving")
        timer = setTimeout(() => setPhase("hidden"), FADE_MS)
      }, Math.max(0, MIN_VISIBLE_MS - (performance.now() - startedAt)))
    }

    // La ruta está lista cuando su estado de carga sale del DOM: el fallback de
    // `loading.tsx` desaparece en el mismo commit que trae el contenido.
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-app-loading]")) {
        seenLoading = true
        return
      }
      if (seenLoading) leave()
    })

    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("load", leave)
    const failsafe = setTimeout(leave, MAX_VISIBLE_MS)

    if (document.readyState === "complete") leave()

    return () => {
      observer.disconnect()
      window.removeEventListener("load", leave)
      clearTimeout(failsafe)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (phase === "hidden") return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "bg-background fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6",
        "transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        phase === "leaving" && "pointer-events-none opacity-0"
      )}
    >
      <div className="splash-enter flex flex-col items-center gap-3">
        <MascotaLogo className="h-24 w-auto" />
        <TvboxWordmark className="h-10 w-auto" />
      </div>
      <div className="flex flex-col items-center gap-2">
        <Spinner className="size-5 opacity-60" aria-hidden="true" />
        <span className="text-muted-foreground text-sm">Cargando…</span>
      </div>
    </div>
  )
}
