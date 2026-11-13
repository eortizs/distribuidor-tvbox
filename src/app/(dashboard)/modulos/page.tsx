import { HerramientasAccordion } from "@/components/herramientas/herramientas-accordion"
import { requireUser } from "@/server/auth/guards"
import { getModulePrefs } from "@/server/modulos/preferences"
import { getHiddenModules } from "@/server/modulos/visibility"

export const metadata = {
  title: "Módulos",
}

export default async function HerramientasPage() {
  const user = await requireUser()
  const [prefs, hiddenModules] = await Promise.all([
    getModulePrefs(user.id),
    // Las cuentas admin siempre ven el catálogo completo: la visibilidad por
    // módulo solo aplica a las cuentas distribuidoras.
    user.role === "admin" ? Promise.resolve([]) : getHiddenModules(user.id),
  ])

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <HerramientasAccordion
        initialPrefs={prefs}
        isAdmin={user.role === "admin"}
        hiddenModules={hiddenModules}
      />
    </div>
  )
}
