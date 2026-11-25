import { isOwnerRole } from "@/server/auth/types"
import { ClientesAccordion } from "@/components/entities/clientes-accordion"
import { ClientesRegistry } from "@/components/clientes/clientes-registry"
import { GettingStartedCard } from "@/components/onboarding/getting-started-card"
import {
  ClientesPlataforma,
  type ClientePlataformaRow,
} from "@/components/plataforma/clientes-plataforma"
import {
  ClientesAfiliado,
  type ClienteAfiliadoRow,
} from "@/components/plataforma/clientes-afiliado"
import {
  findAffiliateByUserId,
  listReferredTenantsForPlatform,
  listReferredTenantsWithOwner,
} from "@/server/afiliados/repository"
import { notFound } from "next/navigation"
import { requireUser } from "@/server/auth/guards"
import { effectiveDbContext, findTenantById } from "@/server/tenant/context"
import { getOnboardingStatus } from "@/server/onboarding/status"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"
import { resolveClientScope } from "@/server/flujotv/scope"
import {
  isCouponQaEnabled,
  licensePriceMxnOrNull,
  transferBankDataOrNull,
} from "@/server/mercadopago/config"
import { getSaldosActual } from "@/server/saldo/service"

export const metadata = {
  title: "Clientes",
}

const CLIENTES_DATE_FORMAT = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Mexico_City",
})

/**
 * La lista se filtra en el servidor según el perfil: el distribuidor solo
 * recibe los clientes de su reseller ligado (`distribuidorName` de su
 * entidad Cuenta); el admin ve el panel completo y además las secciones de
 * revisión de transferencias y de reembolsos (`canReviewTransfers`).
 *
 * `searchParams` trae el retorno del checkout de Mercado Pago (back_urls):
 * `orden` = id de la orden de pago y `estado` = aprobado|rechazado|pendiente;
 * el componente muestra el aviso y sondea el estado real hasta ver la
 * renovación aplicada. `priceMxn`, los datos bancarios de la transferencia y
 * el estado del cupón de QA salen del servidor porque viven en `.env` y nunca
 * llegan al cliente por otra vía; sin datos bancarios la opción de
 * transferencia no se ofrece y sin `COUPON_QA_ENABLED=1` la de cupón tampoco.
 * `saldoCupones` es el saldo en cupones actual del comprador (la billetera
 * que el cupón debita para pagar licencias de FlujoTV): la ventana de pago
 * lo muestra y el servidor exige saldo suficiente antes de aceptar el canje.
 */
export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string; estado?: string }>
}) {
  const [user, params] = await Promise.all([requireUser("core"), searchParams])

  // RAMA DEL HOST DE PLATAFORMA (reestructura de bloques 2026-11-24):
  // clientes SEGMENTADOS por perfil — plataforma ve los negocios referidos
  // por afiliados (no tiene clientes propios); el afiliado, los
  // propietarios de los negocios que llegaron con SU enlace.
  if (resolveTenantHost(await requestHost()).kind === "platform") {
    if (user.role === "plataforma") {
      const referred = await listReferredTenantsForPlatform()
      const rows: ClientePlataformaRow[] = await Promise.all(
        referred.map(async (tenant) => ({
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          configured:
            (await getOnboardingStatus(tenant.id).catch(() => null))?.complete ??
            false,
          affiliateCode: tenant.affiliateCode,
          affiliateName: tenant.affiliateName,
          createdAtLabel: CLIENTES_DATE_FORMAT.format(tenant.createdAt),
        }))
      )
      return (
        <div className="flex flex-1 flex-col p-4 md:p-6">
          <ClientesPlataforma rows={rows} />
        </div>
      )
    }
    if (user.role === "afiliado") {
      const own = await findAffiliateByUserId(user.id)
      if (!own) notFound()
      const referred = await listReferredTenantsWithOwner(own.id)
      const rows: ClienteAfiliadoRow[] = await Promise.all(
        referred.map(async (tenant) => ({
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          configured:
            (await getOnboardingStatus(tenant.id).catch(() => null))?.complete ??
            false,
          ownerEmail: tenant.ownerEmail,
          createdAtLabel: CLIENTES_DATE_FORMAT.format(tenant.createdAt),
        }))
      )
      return (
        <div className="flex flex-1 flex-col p-4 md:p-6">
          <ClientesAfiliado rows={rows} />
        </div>
      )
    }
  }

  // RAMA POR TIPO DE TENANT (§3.5): un negocio solo-núcleo NO tiene FlujoTV
  // — su /clientes es el registro local (nombre, WhatsApp, notas y links).
  // El legado conserva el acordeón FlujoTV intacto. Con onboarding
  // incompleto, el propietario ve la tarjeta «Primeros pasos» (sin rebote:
  // «Saltar» tiene que funcionar).
  const context = await effectiveDbContext()
  const tenant = context?.tenantId ? await findTenantById(context.tenantId) : null
  if (tenant && tenant.kind === "business") {
    const status =
      isOwnerRole(user.role) && tenant.status === "active"
        ? await getOnboardingStatus(tenant.id).catch(() => null)
        : null
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        {status && !status.complete && (
          <GettingStartedCard
            steps={{
              mpToken: status.mpToken.done,
              banking: status.business.done,
              whatsapp: status.whatsapp.done,
            }}
          />
        )}
        <ClientesRegistry groupByOwner={isOwnerRole(user.role)} />
      </div>
    )
  }

  const [scope, saldos] = await Promise.all([
    resolveClientScope(user),
    getSaldosActual(user.id),
  ])
  const distribuidorName = scope.kind === "distributor" ? scope.name : null

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <ClientesAccordion
        distribuidorName={distribuidorName}
        isAdmin={isOwnerRole(user.role)}
        priceMxn={licensePriceMxnOrNull()}
        returnOrder={params.orden?.trim() || null}
        returnState={params.estado?.trim() || null}
        transferBank={transferBankDataOrNull()}
        couponEnabled={isCouponQaEnabled()}
        canReviewTransfers={scope.kind === "all"}
        saldoCupones={saldos.cupones}
      />
    </div>
  )
}
