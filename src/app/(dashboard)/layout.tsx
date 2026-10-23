import { AppHeaderDate } from "@/components/app-header-date"
import { AppSidebar } from "@/components/app-sidebar"
import { mxToday } from "@/lib/finanzas"
import { requireUser } from "@/server/auth/guards"

export const instant = false

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="bg-background sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
          </div>
          <div className="ml-auto flex items-center gap-2 px-4">
            <AppHeaderDate initialDate={mxToday()} />
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
