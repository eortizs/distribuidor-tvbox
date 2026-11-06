import type { Metadata } from "next"

import { Calculadora } from "@/components/herramientas/calculadora/calculadora"
import { CalculadoraBackLink } from "@/components/herramientas/calculadora/back-link"

export const metadata: Metadata = {
  title: "Calculadora",
}

export default function CalculadoraPage() {
  return (
    <div className="relative mx-auto h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space))] min-h-[27.5rem] w-full max-w-xl p-3 sm:p-4">
      <CalculadoraBackLink />
      <Calculadora />
    </div>
  )
}
