import { ClientesAccordion } from "@/components/entities/clientes-accordion"
import { requireUser } from "@/server/auth/guards"
import { resolveClientScope } from "@/server/flujotv/scope"
import { licensePriceMxnOrNull } from "@/server/mercadopago/config"

export const metadata = {
  title: "Clientes",
}

/**
 * La lista se filtra en el servidor según el perfil: el distribuidor solo
 * recibe los clientes de su reseller ligado (`distribuidorName` de su
 * entidad Cuenta); el admin ve el panel completo.
 *
 * `searchParams` trae el retorno del checkout de Mercado Pago (back_urls):
 * `orden` = id de la orden de pago y `estado` = aprobado|rechazado|pendiente;
 * el componente muestra el aviso y sondea el estado real hasta ver la
 * renovación aplicada. `priceMxn` sale del servidor porque el precio vive en
 * `.env` y nunca llega al cliente por otra vía.
 */
export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string; estado?: string }>
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams])
  const scope = await resolveClientScope(user)
  const distribuidorName = scope.kind === "distributor" ? scope.name : null

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <ClientesAccordion
        distribuidorName={distribuidorName}
        priceMxn={licensePriceMxnOrNull()}
        returnOrder={params.orden?.trim() || null}
        returnState={params.estado?.trim() || null}
      />
    </div>
  )
}
