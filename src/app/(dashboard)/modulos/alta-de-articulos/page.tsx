import type { Metadata } from "next"

import { ArticulosView } from "@/components/herramientas/articulos/articulos-view"
import { ARTICULOS_MAX_POR_TENANT } from "@/lib/articulos"
import type { ListadoArticulos } from "@/server/articulos/repository"
import {
  listarArticulos,
  listarCategorias,
} from "@/server/articulos/repository"
import { requireUser } from "@/server/auth/guards"

export const metadata: Metadata = {
  title: "Artículos/Servicios",
}

export default async function AltaArticulosPage() {
  await requireUser("core")

  // Primer pintado con el catálogo COMPLETO: la lista en acordeón no pagina.
  // Un fallo de base de datos no tumba la página: la vista muestra su estado
  // de error con reintentar (mismo contrato que Notas).
  let inicial: ListadoArticulos | null = null
  let categoriasIniciales: string[] = []
  let cargaFallida = false
  try {
    const [listado, categorias] = await Promise.all([
      listarArticulos({ pageSize: ARTICULOS_MAX_POR_TENANT }),
      listarCategorias(),
    ])
    inicial = listado
    categoriasIniciales = categorias
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <h1 className="sr-only">Artículos/Servicios</h1>
      <ArticulosView
        inicial={inicial}
        categoriasIniciales={categoriasIniciales}
        cargaFallida={cargaFallida}
      />
    </div>
  )
}
