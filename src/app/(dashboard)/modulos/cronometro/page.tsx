import type { Metadata } from "next"

import { Cronometro } from "@/components/herramientas/cronometro/cronometro"

export const metadata: Metadata = {
  title: "Cronómetro",
}

export default function CronometroPage() {
  return (
    <div className="relative mx-auto h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space))] min-h-[27.5rem] w-full max-w-xl p-3 sm:p-4">
      <Cronometro />
    </div>
  )
}
