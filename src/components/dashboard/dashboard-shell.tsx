"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { AppHeaderDate } from "@/components/app-header-date"
import { AppBottomNav } from "@/components/dashboard/app-bottom-nav"
import { AppNotifications } from "@/components/dashboard/app-notifications"
import { AppUserMenu } from "@/components/dashboard/app-user-menu"
import { findNavBack, findNavHeaderTitle } from "@/components/dashboard/nav-config"
import { shellLayout } from "@/components/dashboard/nav-layout"
import { MascotaLogo } from "@/components/mascota-logo"
import { RealtimeIndicator } from "@/components/realtime/realtime-indicator"
import { Button } from "@/components/ui/button"
import type { AuthUser } from "@/server/auth/types"

type ShellViewport = {
  /** El teclado virtual está abierto y la barra inferior se retira. */
  keyboardOpen: boolean
  /** Alto útil del viewport (px) mientras el teclado está abierto. */
  height: number | null
}

/**
 * Shell del dashboard: cabecera sticky, contenido y barra inferior fija.
 * Las páginas siguen siendo componentes de servidor: solo el shell es cliente.
 */
export function DashboardShell({
  user,
  initialDate,
  visibleSections,
  children,
}: {
  user: AuthUser
  initialDate: string
  /** Claves de sección visibles para este usuario (permisos por cuenta). */
  visibleSections: string[]
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ""
  /** Rótulo de la sección o pestaña activa en la cabecera, solo donde se declara. */
  const headerTitle = findNavHeaderTitle(pathname)
  /** Regreso de cabecera para rutas más profundas que el hub de la sección. */
  const back = findNavBack(pathname)
  const [viewport, setViewport] = useState<ShellViewport>({
    keyboardOpen: false,
    height: null,
  })

  useEffect(() => {
    const visual = window.visualViewport
    if (!visual) return

    const sync = () => {
      const lost = window.innerHeight - visual.height
      const keyboardOpen = lost > shellLayout.keyboardThreshold
      setViewport((prev) => {
        const height = keyboardOpen ? visual.height : null
        if (prev.keyboardOpen === keyboardOpen && prev.height === height) {
          return prev
        }
        return { keyboardOpen, height }
      })
    }

    sync()
    visual.addEventListener("resize", sync)
    return () => visual.removeEventListener("resize", sync)
  }, [])

  const navSpace = viewport.keyboardOpen
    ? "0px"
    : `calc(${shellLayout.bottomNavHeight} + env(safe-area-inset-bottom))`

  // El Toaster vive en el layout raíz, fuera del shell: el mismo token se
  // publica en el elemento raíz para que los toasts no queden bajo la barra.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--shell-bottom-nav-space", navSpace)
    return () => {
      root.style.removeProperty("--shell-bottom-nav-space")
    }
  }, [navSpace])

  return (
    <div
      className="relative flex h-[var(--shell-viewport-height)] flex-col overflow-hidden"
      style={
        {
          "--shell-viewport-height": viewport.height
            ? `${viewport.height}px`
            : "100svh",
          "--shell-bottom-nav-space": navSpace,
        } as React.CSSProperties
      }
    >
      <header
        className="bg-background sticky top-0 z-30 flex shrink-0 items-center gap-2"
        style={{
          height: "var(--shell-header-height)",
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        <Link
          href="/"
          aria-label="Inicio"
          className="flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MascotaLogo />
        </Link>
        {back ? (
          <h1 className="text-base font-semibold tracking-tight">
            <Button
              variant="ghost"
              className="-ml-2 gap-1 text-base font-semibold tracking-tight"
              render={<Link href={back.href} />}
              nativeButton={false}
            >
              <ChevronLeftIcon aria-hidden="true" className="text-foreground" />
              {headerTitle ?? back.title}
            </Button>
          </h1>
        ) : headerTitle ? (
          <h1 className="text-base font-semibold tracking-tight">
            {headerTitle}
          </h1>
        ) : null}
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <RealtimeIndicator />
          <AppHeaderDate initialDate={initialDate} />
          <AppNotifications />
          <AppUserMenu user={user} />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto pb-[var(--shell-bottom-nav-space)]">
        {children}
      </main>
      {viewport.keyboardOpen ? null : (
        <AppBottomNav visibleSections={visibleSections} />
      )}
    </div>
  )
}
