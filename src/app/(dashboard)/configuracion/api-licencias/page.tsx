import { ConfiguracionMenu } from "@/components/configuracion/configuracion-menu"
import { LicenciasApiView } from "@/components/configuracion/licencias-api-view"
import { requireUser } from "@/server/auth/guards"
import { getFlujoStatus } from "@/server/flujotv/service"

export const instant = false

export const metadata = {
  title: "Configuración · API de licencias",
}

export default async function ApiLicenciasPage() {
  const user = await requireUser()
  const status = await getFlujoStatus()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground text-sm">
          Activa la API de licencias de FlujoTV para consultar y renovar las
          licencias de los clientes del panel.
        </p>
      </div>

      <ConfiguracionMenu active="api-licencias" />

      <LicenciasApiView
        configured={status.configured}
        keySource={status.keySource}
        maskedKey={status.maskedKey}
        baseUrl={status.baseUrl}
        updatedAt={status.updatedAt}
        health={status.health}
        isAdmin={user.role === "admin"}
      />
    </div>
  )
}
