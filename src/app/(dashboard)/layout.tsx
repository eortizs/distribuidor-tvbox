import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { RealtimeProvider } from "@/components/realtime/realtime-provider"
import { mxToday } from "@/lib/finanzas"
import { requireUser } from "@/server/auth/guards"
import { getVisibleSectionKeys } from "@/server/auth/permissions"

export const instant = false

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()
  const visibleSections = await getVisibleSectionKeys(user)

  return (
    <RealtimeProvider>
      <DashboardShell
        user={user}
        initialDate={mxToday()}
        visibleSections={visibleSections}
      >
        {children}
      </DashboardShell>
    </RealtimeProvider>
  )
}
