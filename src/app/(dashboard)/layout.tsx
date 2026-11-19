import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { AppSplash } from "@/components/app-splash"
import { RealtimeProvider } from "@/components/realtime/realtime-provider"
import { requireUser } from "@/server/auth/guards"
import { getVisibleSectionKeys } from "@/server/auth/permissions"
import { getSaldosActual } from "@/server/saldo/service"

export const instant = false

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()
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
      >
        {children}
      </DashboardShell>
    </RealtimeProvider>
  )
}
