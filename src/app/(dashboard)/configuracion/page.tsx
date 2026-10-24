import { ConfiguracionMenu } from "@/components/configuracion/configuracion-menu"
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
          Ajustes del panel: los modelos de imagen de cada nivel de calidad y la
          API de licencias de FlujoTV.
        </p>
      </div>

      <ConfiguracionMenu active="modelos-imagen" />

      <ConfiguracionView models={allImageModels()} levels={levels} />
    </div>
  )
}
