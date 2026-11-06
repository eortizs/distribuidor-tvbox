import { ClientesAccordion } from "@/components/entities/clientes-accordion"
import { requireUser } from "@/server/auth/guards"
import { resolveClientScope } from "@/server/flujotv/scope"

export const metadata = {
  title: "Clientes",
}

/**
 * La lista se filtra en el servidor según el perfil: el distribuidor solo
 * recibe los clientes de su reseller ligado (`distribuidorName` de su
 * entidad Cuenta); el admin ve el panel completo.
 */
export default async function EntitiesPage() {
  const user = await requireUser()
  const scope = await resolveClientScope(user)
  const distribuidorName = scope.kind === "distributor" ? scope.name : null

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <ClientesAccordion distribuidorName={distribuidorName} />
    </div>
  )
}
