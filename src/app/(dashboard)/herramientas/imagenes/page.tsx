import type { Metadata } from "next"

import { ImageStudio } from "@/components/herramientas/imagenes/image-studio"
import { requireUser } from "@/server/auth/guards"
import { getImageLevels } from "@/server/images/settings"

export const metadata: Metadata = {
  title: "Imágenes",
}

export default async function ImagenesPage() {
  const user = await requireUser()
  const levels = await getImageLevels(user.id)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Imágenes</h1>
          <p className="text-muted-foreground text-sm">
            Genera imágenes con IA y lleva el control de lo que cuesta cada una,
            en pesos mexicanos al tipo de cambio FIX de Banxico del día de uso.
          </p>
        </div>
      </div>
      <ImageStudio levels={levels} />
    </div>
  )
}
