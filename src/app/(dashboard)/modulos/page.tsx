import { isOwnerRole } from "@/server/auth/types"
import { HerramientasAccordion } from "@/components/herramientas/herramientas-accordion"
import { modulosForTenantModules } from "@/lib/modulos"
import { PlatformModulosHub } from "@/components/plataforma/platform-modulos-hub"
import { requireUser } from "@/server/auth/guards"
import { getModulePrefs } from "@/server/modulos/preferences"
import { getHiddenModules } from "@/server/modulos/visibility"
import { effectiveTenantModules } from "@/server/tenant/modules"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"
import { Frame, FrameDescription, FrameHeader, FrameTitle } from "@/components/reui/frame"

export const metadata = {
  title: "Módulos",
}

export default async function HerramientasPage() {
  const user = await requireUser("general")

  // RAMA DEL HOST DE PLATAFORMA (reestructura de bloques 2026-11-24):
  // plataforma ve el hub propio (Tenants y Afiliados); el afiliado aún no
  // tiene módulos — su trabajo vive en Inicio y Clientes.
  if (resolveTenantHost(await requestHost()).kind === "platform") {
    if (user.role === "plataforma") {
      return (
        <div className="flex flex-1 flex-col p-4 md:p-6">
          <PlatformModulosHub />
        </div>
      )
    }
    if (user.role === "afiliado") {
      return (
        <div className="flex flex-1 flex-col p-4 md:p-6">
          <Frame>
            <FrameHeader className="flex flex-col gap-1">
              <FrameTitle>Módulos</FrameTitle>
              <FrameDescription>
                Aún no tienes módulos: tu enlace y tus cifras están en Inicio
                y tus negocios en Clientes.
              </FrameDescription>
            </FrameHeader>
          </Frame>
        </div>
      )
    }
  }

  // El catálogo se filtra por los módulos del TENANT (§4.5): el legado ve
  // los tres módulos; un negocio solo núcleo. La visibilidad por usuario
  // (hiddenModules) se aplica encima.
  const tenantModules = await effectiveTenantModules()
  const [prefs, hiddenModules] = await Promise.all([
    getModulePrefs(user.id),
    // Las cuentas admin siempre ven el catálogo completo: la visibilidad por
    // módulo solo aplica a las cuentas distribuidoras.
    isOwnerRole(user.role) ? Promise.resolve([]) : getHiddenModules(user.id),
  ])

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <HerramientasAccordion
        initialPrefs={prefs}
        isAdmin={isOwnerRole(user.role)}
        hiddenModules={hiddenModules}
        modulos={modulosForTenantModules(tenantModules)}
      />
    </div>
  )
}
