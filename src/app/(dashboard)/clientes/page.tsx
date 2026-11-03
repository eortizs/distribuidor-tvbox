import { ClientesAccordion } from "@/components/entities/clientes-accordion"

export const metadata = {
  title: "Clientes",
}

export default function EntitiesPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Clientes</h1>
        <p className="text-muted-foreground text-sm">
          Clientes del panel de FlujoTV y el estado de su licencia.
        </p>
      </div>
      <ClientesAccordion />
    </div>
  )
}
