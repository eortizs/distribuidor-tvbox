import { HerramientasAccordion } from "@/components/herramientas/herramientas-accordion"
import { requireUser } from "@/server/auth/guards"
import { getModulePrefs } from "@/server/modulos/preferences"

export const metadata = {
  title: "Módulos",
}

export default async function HerramientasPage() {
  const user = await requireUser()
  const prefs = await getModulePrefs(user.id)

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <HerramientasAccordion initialPrefs={prefs} />
    </div>
  )
}
