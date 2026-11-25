import type { ReactNode } from "react"

import { cn } from "cn"
import { TvboxWordmark } from "@/components/tvbox-wordmark"
import { SpeilinkLogo } from "@/components/speilink-logo"

/**
 * Marco de login/registro. La marca depende del HOST (multitenant §2.5): el
 * legado `tvbox` conserva TVBOX Network; los hosts de tenant y plataforma
 * muestran SPEILink (la marca del producto). El host de plataforma añade la
 * clase `theme-platform` (paleta verde #085C34 / azul técnico #0F172A vía
 * `body:has(.theme-platform)` en globals.css); los demás hosts conservan la
 * paleta neutra.
 */
export async function AuthShell({ children }: { children: ReactNode }) {
  const { requestHost } = await import("@/server/tenant/request-host")
  const { resolveTenantHost } = await import("@/server/tenant/hosts")
  const hostKind = resolveTenantHost(await requestHost()).kind

  return (
    <div
      className={cn(
        "bg-background flex min-h-svh flex-col items-center justify-center p-4",
        hostKind === "platform" && "theme-platform"
      )}
    >
      <div className="mb-6 flex items-center">
        {hostKind === "legacy" ? (
          <TvboxWordmark className="h-12" />
        ) : (
          <SpeilinkLogo className="h-14" />
        )}
      </div>
      {children}
    </div>
  )
}
