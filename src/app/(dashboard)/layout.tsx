import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { RealtimeProvider } from "@/components/realtime/realtime-provider"
import { requireUser } from "@/server/auth/guards"
import { getVisibleSectionKeys } from "@/server/auth/permissions"
import { getSaldoActual } from "@/server/saldo/service"

export const instant = false

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()
  const [visibleSections, saldo] = await Promise.all([
    getVisibleSectionKeys(user),
    getSaldoActual(user.id),
  ])

  return (
    <RealtimeProvider>
      <DashboardShell user={user} saldo={saldo} visibleSections={visibleSections}>
        {children}
      </DashboardShell>
    </RealtimeProvider>
  )
}
