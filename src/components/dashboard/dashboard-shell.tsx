"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { AppHeaderDate } from "@/components/app-header-date"
import { AppBottomNav } from "@/components/dashboard/app-bottom-nav"
import { AppUserMenu } from "@/components/dashboard/app-user-menu"
import { shellLayout } from "@/components/dashboard/nav-layout"
import { MascotaLogo } from "@/components/mascota-logo"
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
  children,
}: {
  user: AuthUser
  initialDate: string
  children: React.ReactNode
}) {
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
      className="relative flex min-h-svh flex-col"
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
        className="bg-background sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b"
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
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <AppHeaderDate initialDate={initialDate} />
          <AppUserMenu user={user} />
        </div>
      </header>
      <main className="flex-1 pb-[var(--shell-bottom-nav-space)]">
        {children}
      </main>
      {viewport.keyboardOpen ? null : <AppBottomNav />}
    </div>
  )
}
