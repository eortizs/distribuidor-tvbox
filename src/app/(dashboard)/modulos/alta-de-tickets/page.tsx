import type { Metadata } from "next"

import type { TicketVista } from "@/lib/tickets"
import { Tickets } from "@/components/herramientas/tickets/tickets"
import { requireUser } from "@/server/auth/guards"
import { listarVista } from "@/server/tickets/service"

export const metadata: Metadata = {
  title: "Alta de tickets",
}

export default async function AltaTicketsPage() {
  const user = await requireUser()

  // Primer pintado con el historial real, sin parpadeo de carga. Un fallo de
  // base de datos no tumba la página: el cliente muestra su estado de error
  // con reintentar.
  let inicial: { items: TicketVista[]; total: number } | null = null
  let cargaFallida = false
  try {
    inicial = await listarVista(user.id, { limit: 20 })
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Alta de tickets</h1>
      <Tickets inicial={inicial} cargaFallida={cargaFallida} />
    </div>
  )
}
