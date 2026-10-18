import type { ReactNode } from "react"

import { ToguLogo } from "@/components/togu-logo"

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center p-4">
      <div className="mb-6 flex items-center gap-2">
        <ToguLogo className="size-8" />
        <span className="text-lg font-semibold tracking-tight">Togu</span>
      </div>
      {children}
    </div>
  )
}
