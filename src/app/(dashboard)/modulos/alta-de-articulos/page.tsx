import type { Metadata } from "next"

import { ArticulosView } from "@/components/herramientas/articulos/articulos-view"
import type { ListadoArticulos } from "@/server/articulos/repository"
import {
  listarArticulos,
  listarCategorias,
} from "@/server/articulos/repository"
import { requireUser } from "@/server/auth/guards"

export const metadata: Metadata = {
  title: "Alta de Artículos/Servicios",
}

export default async function AltaArticulosPage() {
  await requireUser("core")

  // Primer pintado con el listado real, sin parpadeo de carga. Un fallo de
  // base de datos no tumba la página: la vista muestra su estado de error
  // con reintentar (mismo contrato que Notas).
  let inicial: ListadoArticulos | null = null
  let categoriasIniciales: string[] = []
  let cargaFallida = false
  try {
    const [listado, categorias] = await Promise.all([
      listarArticulos({}),
      listarCategorias(),
    ])
    inicial = listado
    categoriasIniciales = categorias
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Alta de Artículos/Servicios</h1>
      <ArticulosView
        inicial={inicial}
        categoriasIniciales={categoriasIniciales}
        cargaFallida={cargaFallida}
      />
    </div>
  )
}
