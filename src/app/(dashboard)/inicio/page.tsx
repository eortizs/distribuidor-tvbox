import { redirect } from "next/navigation"
import QRCode from "qrcode"
import { notFound } from "next/navigation"

import { InicioAfiliado } from "@/components/plataforma/afiliado/inicio-afiliado"
import { Frame, FrameDescription, FrameHeader, FrameTitle } from "@/components/reui/frame"
import {
  findAffiliateByUserId,
  getAffiliatePortalData,
  listAffiliates,
} from "@/server/afiliados/repository"
import { requireUser } from "@/server/auth/guards"
import { getOnboardingStatus } from "@/server/onboarding/status"
import { affiliateLinkUrl } from "@/lib/afiliados"
import { shortLinkBaseUrl } from "@/server/site-url"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"
import { listPlatformTenants } from "@/server/tenants/platform"

export const instant = false

export const metadata = {
  title: "Inicio",
}

const DATE_CUTOFF = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

/**
 * Sección INICIO del host de plataforma (reestructura de bloques
 * 2026-11-24): resumen por perfil — plataforma ve conteos generales; el
 * afiliado, su enlace y cifras (lo que era el portal `/afiliado`). En los
 * DEMÁS hosts el bloque Inicio del panel vive en la raíz `/`: esta ruta
 * redirige allí (el legado no cambia).
 */
export default async function InicioPage() {
  const hostKind = resolveTenantHost(await requestHost()).kind
  if (hostKind !== "platform") {
    redirect("/")
  }
  const user = await requireUser("core")

  if (user.role === "afiliado") {
    const own = await findAffiliateByUserId(user.id)
    if (!own) notFound()
    const data = await getAffiliatePortalData(own.id)
    if (!data) notFound()
    const link = affiliateLinkUrl(data.affiliate.code, shortLinkBaseUrl())
    const qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 320 })
    const configuredCount = await Promise.all(
      data.referredTenants.map((tenant) => getOnboardingStatus(tenant.id))
    ).then((statuses) => statuses.filter((status) => status?.complete).length)
    return (
      <div className="flex flex-1 flex-col p-4 md:p-6">
        <InicioAfiliado
          code={data.affiliate.code}
          fullName={data.affiliate.fullName}
          email={data.email}
          status={data.affiliate.status}
          clickCount={data.affiliate.clickCount}
          signupCount={data.referredTenants.length}
          configuredCount={configuredCount}
          link={link}
          qrDataUrl={qrDataUrl}
        />
      </div>
    )
  }

  if (user.role === "plataforma") {
    const [tenants, affiliates] = await Promise.all([
      listPlatformTenants(),
      listAffiliates(),
    ])
    const negocios = tenants.filter((tenant) => tenant.kind === "business")
    const activos = negocios.filter((tenant) => tenant.status === "active")
    const altasRecientes = negocios.filter(
      (tenant) => tenant.createdAt >= DATE_CUTOFF
    ).length
    const afiliadosActivos = affiliates.filter(
      (affiliate) => affiliate.status === "active"
    ).length
    const referidos = negocios.filter(
      (tenant) => tenant.affiliateCode !== null
    ).length
    const stats = [
      { label: "Negocios activos", value: activos.length },
      { label: "Negocios referidos", value: referidos },
      { label: "Afiliados activos", value: afiliadosActivos },
      { label: "Altas últimos 30 días", value: altasRecientes },
    ]
    return (
      <div className="flex flex-1 flex-col p-4 md:p-6">
        <Frame className="flex flex-1 flex-col gap-4">
          <FrameHeader className="flex flex-col gap-1">
            <FrameTitle>Resumen</FrameTitle>
            <FrameDescription>
              Estado general de la plataforma. Los negocios referidos, con su
              afiliado, están en Clientes; la gestión completa en Módulos.
            </FrameDescription>
          </FrameHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col gap-1 rounded-xl border bg-muted/30 p-4"
              >
                <span className="text-2xl font-semibold tabular-nums">{stat.value}</span>
                <span className="text-muted-foreground text-sm">{stat.label}</span>
              </div>
            ))}
          </div>
        </Frame>
      </div>
    )
  }

  notFound()
}
