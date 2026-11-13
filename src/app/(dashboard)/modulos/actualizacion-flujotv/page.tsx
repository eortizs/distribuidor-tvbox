import type { Metadata } from "next"

import { ActualizacionFlujoTv } from "@/components/herramientas/actualizacion-flujotv/actualizacion-flujotv-view"
import { requireUser } from "@/server/auth/guards"
import { getFlujoApp } from "@/server/flujotv/app"

export const metadata: Metadata = {
  title: "Actualización FlujoTV",
}

type SearchParams = Record<string, string | string[] | undefined>

function primerValor(valor: string | string[] | undefined): string | null {
  const valorUnico = Array.isArray(valor) ? valor[0] : valor
  return valorUnico ?? null
}

export default async function ActualizacionFlujoTvPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await requireUser()
  // Valores vigentes (fila guardada o defaults). Un fallo de DB no tumba
  // la página: getFlujoApp devuelve los valores por defecto.
  const app = await getFlujoApp()

  const puedeEditar = user.role === "admin"
  const params = await searchParams
  // «Configurar» en el hub llega por aquí: solo un admin entra en modo
  // edición; para el resto el parámetro se ignora.
  const editarInicial = puedeEditar && primerValor(params.editar) === "1"

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <ActualizacionFlujoTv
        inicial={app}
        puedeEditar={puedeEditar}
        editarInicial={editarInicial}
      />
    </div>
  )
}
