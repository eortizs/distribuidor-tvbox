import { isOwnerRole } from "@/server/auth/types"
import { HerramientasAccordion } from "@/components/herramientas/herramientas-accordion"
import { modulosForTenantModules } from "@/lib/modulos"
import { requireUser } from "@/server/auth/guards"
import { getModulePrefs } from "@/server/modulos/preferences"
import { getHiddenModules } from "@/server/modulos/visibility"
import { effectiveTenantModules } from "@/server/tenant/modules"

export const metadata = {
  title: "Módulos",
}

export default async function HerramientasPage() {
  const user = await requireUser("general")
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
