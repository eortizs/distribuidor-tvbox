import type { Metadata } from "next"

import { ListaCompras } from "@/components/herramientas/lista-compras/lista-compras"
import { requireUser } from "@/server/auth/guards"
import { obtenerLista } from "@/server/lista-compras/repository"
import type { SnapshotLista } from "@/lib/lista-compras"

export const metadata: Metadata = {
  title: "Lista de compras",
}

export default async function ListaComprasPage() {
  const user = await requireUser()

  // Primer pintado con el estado real de la lista, sin parpadeo de carga.
  // Un fallo de base de datos no tumba la página: el cliente muestra su
  // estado de error con reintentar.
  let inicial: SnapshotLista | null = null
  let cargaFallida = false
  try {
    inicial = await obtenerLista(user.id)
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Lista de compras</h1>
      <ListaCompras inicial={inicial} cargaFallida={cargaFallida} />
    </div>
  )
}
