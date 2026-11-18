import type { Metadata } from "next"

import { Notas } from "@/components/herramientas/notas/notas"
import { requireUser } from "@/server/auth/guards"
import type { NotaPreview } from "@/lib/notas"
import { listarNotas } from "@/server/notas/repository"

export const metadata: Metadata = {
  title: "Notas",
}

export default async function NotasPage() {
  const user = await requireUser()

  // Primer pintado con el listado real, sin parpadeo de carga. Un fallo de
  // base de datos no tumba la página: el cliente muestra su estado de error
  // con reintentar (mismo contrato que Lista de compras).
  let inicial: NotaPreview[] | null = null
  let cargaFallida = false
  try {
    inicial = await listarNotas(user.id)
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Notas</h1>
      <Notas inicial={inicial} cargaFallida={cargaFallida} />
    </div>
  )
}
