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
      <h1 className="sr-only">Imágenes</h1>
      <ImageStudio levels={levels} />
    </div>
  )
}
