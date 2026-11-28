import type { Metadata } from "next"

import { InventarioView } from "@/components/herramientas/inventario/inventario-view"
import type { ResumenInventario } from "@/lib/inventario"
import type { ListadoLotes } from "@/server/inventario/repository"
import { listarLotes, resumenInventario } from "@/server/inventario/repository"
import { requireUser } from "@/server/auth/guards"

export const metadata: Metadata = {
  title: "Inventario",
}

export default async function InventarioPage() {
  await requireUser("core")

  // Primer pintado servido por la RSC: lotes + resumen del encabezado. El
  // catálogo para el picker de «Nuevo lote» NO viaja aquí (son hasta 5 000
  // artículos re-serializados en cada refresh de realtime): lo carga la
  // vista bajo demanda al abrir el sheet. Un fallo de base de datos no
  // tumba la página: la vista muestra su estado de error con reintentar
  // (mismo contrato que Notas y Alta de Artículos).
  let inicial: ListadoLotes | null = null
  let resumen: ResumenInventario | null = null
  let cargaFallida = false
  try {
    const [listado, resumenInicial] = await Promise.all([
      listarLotes(),
      resumenInventario(),
    ])
    inicial = listado
    resumen = resumenInicial
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <h1 className="sr-only">Inventario</h1>
      <InventarioView
        inicial={inicial}
        resumenInicial={resumen}
        cargaFallida={cargaFallida}
      />
    </div>
  )
}
