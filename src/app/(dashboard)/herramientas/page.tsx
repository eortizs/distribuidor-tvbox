import { HerramientasAccordion } from "@/components/herramientas/herramientas-accordion"

export const metadata = {
  title: "Herramientas",
}

export default function HerramientasPage() {
  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <HerramientasAccordion />
    </div>
  )
}
