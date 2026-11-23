import type { Metadata } from "next"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { AppSplash } from "@/components/app-splash"
import { RealtimeProvider } from "@/components/realtime/realtime-provider"
import { requireUser } from "@/server/auth/guards"
import { getVisibleSectionKeys } from "@/server/auth/permissions"
import { getSaldosActual } from "@/server/saldo/service"
import { effectiveDbContext, findTenantById } from "@/server/tenant/context"

export const instant = false

/** Branding multitenant (§2.5): el nombre del negocio en el título. */
export async function generateMetadata(): Promise<Metadata> {
  const context = await effectiveDbContext()
  if (!context?.tenantId) return {}
  const tenant = await findTenantById(context.tenantId)
  return tenant ? { title: { default: tenant.name, template: `%s · ${tenant.name}` } } : {}
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser("general")
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
