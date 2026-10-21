import { ConfiguracionView } from "@/components/configuracion/configuracion-view"
import { requireUser } from "@/server/auth/guards"
import { allImageModels } from "@/server/images/models"
import { getImageLevelConfigs } from "@/server/images/settings"

export const instant = false

export const metadata = {
  title: "Configuración",
}

export default async function ConfiguracionPage() {
  const user = await requireUser()
  const levels = await getImageLevelConfigs(user.id)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground text-sm">
          Ajustes de tu cuenta: qué modelo de imagen, con qué calidad y a qué
          tamaño usa cada nivel del control de calidad de la herramienta
          Imágenes.
        </p>
      </div>

      <ConfiguracionView models={allImageModels()} levels={levels} />
    </div>
  )
}
