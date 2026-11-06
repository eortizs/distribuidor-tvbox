import type { ReactNode } from "react"

import { TvboxWordmark } from "@/components/tvbox-wordmark"

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center p-4">
      <div className="mb-6 flex items-center">
        <TvboxWordmark className="h-12" />
      </div>
      {children}
    </div>
  )
}
