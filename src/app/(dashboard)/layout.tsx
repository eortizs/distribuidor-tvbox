import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { mxToday } from "@/lib/finanzas"
import { requireUser } from "@/server/auth/guards"

export const instant = false

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  return (
    <DashboardShell user={user} initialDate={mxToday()}>
      {children}
    </DashboardShell>
  )
}
