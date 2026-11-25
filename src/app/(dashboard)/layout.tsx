import type { Metadata } from "next"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { AppSplash } from "@/components/app-splash"
import { RealtimeProvider } from "@/components/realtime/realtime-provider"
import { PlatformShell } from "@/components/plataforma/platform-shell"
import { isAffiliateRole, isPlatformRole } from "@/server/auth/types"
import { requireUser } from "@/server/auth/guards"
import { getVisibleSectionKeys } from "@/server/auth/permissions"
import { getSaldosActual } from "@/server/saldo/service"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"
import { effectiveDbContext, findTenantById } from "@/server/tenant/context"

export const instant = false

/** Branding multitenant (§2.5) + marca por host (reestructura 2026-11-24):
 *  el negocio pone su nombre en el título; el HOST DE PLATAFORMA (cuentas
 *  sin tenant) viste SPEILink en título, applicationName y PWA — la pestaña
 *  jamás lee TVBOX allí. El legado conserva su comportamiento exacto. */
export async function generateMetadata(): Promise<Metadata> {
  const hostKind = resolveTenantHost(await requestHost()).kind
  const context = await effectiveDbContext()
  if (hostKind === "platform" && !context?.tenantId) {
    return {
      title: { default: "SPEILink", template: "%s" },
      description: "Panel de administración de SPEILink",
      applicationName: "SPEILink",
      appleWebApp: {
        capable: true,
        title: "SPEILink",
        statusBarStyle: "default",
      },
    }
  }
  if (!context?.tenantId) return {}
  const tenant = await findTenantById(context.tenantId)
  return tenant ? { title: { default: tenant.name, template: `%s · ${tenant.name}` } } : {}
}

/**
 * Layout del grupo del PANEL: sirve TODOS los hosts con panel (legado
 * `tvbox`, negocios `<slug>.spei.link` y plataforma). La rama del HOST DE
 * PLATAFORMA (2026-11-24) monta `PlatformShell` con los cinco bloques
 * (inicio, módulos, clientes, finanzas, ayuda) y SIN saldos ni branding de
 * tenant — las cuentas de plataforma y afiliado no tienen tenant; el legado
 * y los negocios conservan el DashboardShell intacto.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser("core")
  const hostKind = resolveTenantHost(await requestHost()).kind
  if (
    hostKind === "platform" &&
    user.tenantId === null &&
    (isPlatformRole(user.role) || isAffiliateRole(user.role))
  ) {
    return (
      <RealtimeProvider>
        <AppSplash logo="speilink" />
        <PlatformShell user={{ username: user.username, role: user.role }}>
          {children}
        </PlatformShell>
      </RealtimeProvider>
    )
  }
  const context = await effectiveDbContext()
  const tenant = context?.tenantId ? await findTenantById(context.tenantId) : null
  const [visibleSections, saldos] = await Promise.all([
    getVisibleSectionKeys(user),
    getSaldosActual(user.id),
  ])

  return (
    <RealtimeProvider>
      {/* Splash solo del panel: vive en ESTE layout (no en el raíz) para que
          la landing /short y login/register no lo monten jamás — su «Cargando…»
          en el HTML estático de la landing causaba flash y CLS en móvil. */}
      <AppSplash />
      <DashboardShell
        user={user}
        saldoCupones={saldos.cupones}
        saldoTokens={saldos.tokens}
        visibleSections={visibleSections}
        tenantName={tenant?.name ?? null}
      >
        {children}
      </DashboardShell>
    </RealtimeProvider>
  )
}
