import { ClientesAccordion } from "@/components/entities/clientes-accordion"

export const metadata = {
  title: "Clientes",
}

/** El rótulo de la sección vive en la cabecera, junto a la mascota. */
export default function EntitiesPage() {
  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <ClientesAccordion />
    </div>
  )
}
