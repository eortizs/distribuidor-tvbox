import type { Metadata } from "next"

import { ToolLauncher } from "@/components/herramientas/tool-launcher"

export const metadata: Metadata = {
  title: "Herramientas",
}

export default function HerramientasPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Herramientas</h1>
        <p className="text-muted-foreground text-sm">
          Elige una herramienta para empezar.
        </p>
      </div>
      <ToolLauncher />
    </div>
  )
}
