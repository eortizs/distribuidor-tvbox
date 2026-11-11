import type { Metadata } from "next"

import {
  ConectoresView,
  type ConectorFlash,
} from "@/components/conectores/conectores-view"
import { findConector } from "@/lib/conectores"
import { requireUser } from "@/server/auth/guards"
import {
  isConectoresGoogleListo,
  listarConexiones,
} from "@/server/conectores/repository"

export const metadata: Metadata = {
  title: "Conectores",
}

type SearchParams = Record<string, string | string[] | undefined>

function primerValor(valor: string | string[] | undefined): string | null {
  const valorUnico = Array.isArray(valor) ? valor[0] : valor
  return valorUnico ?? null
}

export default async function ConectoresPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await requireUser()
  const params = await searchParams

  // Resultado del flujo OAuth, llegado por query. El id de conector solo
  // se usa si existe en el catálogo; los códigos desconocidos caen al
  // mensaje genérico de la vista.
  const conectado = primerValor(params.conectado)
  const error = primerValor(params.error)
  const conectorQuery = primerValor(params.conector)
  let flash: ConectorFlash | null = null
  if (conectado && findConector(conectado)) {
    flash = { tipo: "conectado", conectorId: conectado }
  } else if (error) {
    flash = { tipo: "error", codigo: error, conectorId: conectorQuery ?? undefined }
  }

  // Un fallo de base de datos no tumba la página: la vista muestra su
  // estado de error con reintentar.
  let conexiones = null
  let cargaFallida = false
  try {
    conexiones = await listarConexiones(user.id)
  } catch {
    cargaFallida = true
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Conectores</h1>
      <ConectoresView
        conexiones={conexiones}
        cargaFallida={cargaFallida}
        flash={flash}
        googleListo={isConectoresGoogleListo()}
      />
    </div>
  )
}
