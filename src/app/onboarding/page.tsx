import { redirect } from "next/navigation"
import { isOwnerRole } from "@/server/auth/types"

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
import { requireUser } from "@/server/auth/guards"
import { getProfile } from "@/server/auth/profile"
import { getTenantBanking, getTenantMpTokenStatus } from "@/server/tenants/business"
import { businessTenantIdOfUser } from "@/server/tenants/business"
import { getOnboardingStatus } from "@/server/onboarding/status"
import { findTenantById } from "@/server/tenant/context"
import { tenantBaseHost, hostSlugPrefix } from "@/server/tenant/hosts"

export const instant = false

export const metadata = {
  title: "Configuración",
}

/**
 * Asistente de configuración del negocio (§4.3 del plan): SOLO el
 * propietario de un tenant de negocio. El resto del panel redirige a
 * /clientes. Con la configuración completa, /onboarding sigue siendo la
 * pantalla de edición de estos datos.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ paso?: string }>
}) {
  const [user, params] = await Promise.all([requireUser("core"), searchParams])

  const tenantId = await businessTenantIdOfUser(user.id)
  if (!tenantId || !isOwnerRole(user.role)) {
    redirect("/clientes")
  }

  const status = await getOnboardingStatus(tenantId)
  if (!status) {
    redirect("/clientes")
  }

  const [tenant, banking, tokenStatus, profile] = await Promise.all([
    findTenantById(tenantId),
    getTenantBanking(tenantId),
    getTenantMpTokenStatus(tenantId),
    getProfile(user.id).catch(() => null),
  ])

  const pasoRaw = Number(params.paso)
  const initialStep = Number.isInteger(pasoRaw) && pasoRaw >= 0 ? Math.min(pasoRaw, 4) : -1

  return (
    <OnboardingWizard
      businessName={status.name}
      slug={status.slug}
      baseHost={`${hostSlugPrefix()}${tenantBaseHost()}`}
      steps={{
        mpToken: status.mpToken.done,
        banking: status.business.done,
        whatsapp: status.whatsapp.done,
      }}
      ownerFullName={profile?.account?.fullName ?? ""}
      banking={{
        bankName: banking?.bankName ?? "",
        bankHolder: banking?.bankHolder ?? "",
        bankClabe: banking?.bankClabe ?? "",
      }}
      token={
        tokenStatus
          ? {
              nickname: tokenStatus.nickname,
              last4: tokenStatus.last4,
              status: tokenStatus.status,
            }
          : null
      }
      whatsappNumber={tenant?.whatsappNumber ?? null}
      whatsappLinked={tenant?.whatsappLinkedAt !== null}
      referralUrl={process.env.MERCADOPAGO_REFERRAL_URL?.trim() || null}
      initialStep={initialStep}
    />
  )
}
