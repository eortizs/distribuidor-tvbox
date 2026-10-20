import type { Metadata } from "next"

import { AnimacionAgent } from "@/components/herramientas/animacion/animacion-agent"

export const metadata: Metadata = {
  title: "Animación",
}

export default function AnimacionPage() {
  return (
    <div className="flex h-[calc(100svh-4rem)] flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Animación</h1>
          <p className="text-muted-foreground text-sm">
            Desarrolla ideas, guiones, storyboards y prompts para tus
            animaciones con el agente EVE.
          </p>
        </div>
      </div>
      <AnimacionAgent />
    </div>
  )
}
