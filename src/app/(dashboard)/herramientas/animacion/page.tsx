import type { Metadata } from "next"

import { AnimacionStudio } from "@/components/herramientas/animacion/animacion-studio"
import { animationModels } from "@/server/animaciones/models"

export const metadata: Metadata = {
  title: "Animación",
}

export default function AnimacionPage() {
  return (
    <div className="flex h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space))] flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Animación</h1>
          <p className="text-muted-foreground text-sm">
            Desarrolla ideas, guiones, storyboards y renders con el agente EVE;
            cada entregable llega a tu galería con su costo en pesos y el tiempo
            de trabajo invertido.
          </p>
        </div>
      </div>
      <AnimacionStudio models={animationModels()} />
    </div>
  )
}
