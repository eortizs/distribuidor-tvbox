import { DashboardShell } from "@/components/dashboard/dashboard-shell"
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
    <DashboardShell
      user={user}
      initialDate={mxToday()}
      visibleSections={visibleSections}
    >
      {children}
    </DashboardShell>
  )
}
