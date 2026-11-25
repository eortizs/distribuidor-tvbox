"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeftIcon, LogOutIcon } from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import {
  findPlatformNavBack,
  findPlatformNavHeaderTitle,
  isPlatformNavPathActive,
  platformNavSections,
} from "@/components/plataforma/platform-nav-config"
import { PLATFORM_MODULOS } from "@/lib/platform-modulos"
import { shellLayout } from "@/components/dashboard/nav-layout"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AuthUser } from "@/server/auth/types"

type ShellViewport = {
  keyboardOpen: boolean
  height: number | null
}

/**
 * Shell del HOST DE PLATAFORMA (`platform.spei.link`), mismo cuerpo que el
 * DashboardShell del panel: cabecera sticky, contenido y barra inferior fija
 * con los cinco bloques (Inicio, Módulos, Clientes, Finanzas, Ayuda). Publica
 * las MISMAS variables CSS `--shell-*` que las páginas del panel esperan
 * (el asistente de Ayuda las usa para su alto). Sin saldos ni notificaciones
 * del panel: el menú de cuenta lleva rol, correo y Cerrar sesión.
 */
export function PlatformShell({
  user,
  children,
}: {
  user: Pick<AuthUser, "username" | "role">
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ""
  // El catálogo se importa AQUÍ (componente cliente): jamás viaja como prop
  // del servidor — lleva `icon: LucideIcon` (función) y las funciones NO
  // cruzan la frontera RSC (React #441, regla del hub de módulos).
  const headerTitle = findPlatformNavHeaderTitle(
    pathname,
    PLATFORM_MODULOS
  )
  const back = findPlatformNavBack(pathname)
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

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--shell-bottom-nav-space", navSpace)
    return () => {
      root.style.removeProperty("--shell-bottom-nav-space")
    }
  }, [navSpace])

  return (
    <div
      className="bg-background text-foreground relative flex h-[var(--shell-viewport-height)] flex-col overflow-hidden"
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
          href="/inicio"
          aria-label="Inicio"
          className="flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/speilink-logo-s.svg"
            alt=""
            aria-hidden="true"
            className="h-7 w-auto"
          />
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
          <h1 className="inline-flex items-baseline gap-2 text-base font-semibold tracking-tight">
            {headerTitle}
          </h1>
        ) : null}
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="relative size-9 rounded-full after:content-[''] after:absolute after:-inset-2"
                  aria-label="Menú de cuenta"
                />
              }
            >
              <span
                aria-hidden="true"
                className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-full text-xs font-semibold select-none"
              >
                {user.username.slice(0, 2).toUpperCase()}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col">
                <span className="truncate">{user.username}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {user.role === "plataforma" ? "Plataforma" : "Afiliado"}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form action={logoutAction}>
                <DropdownMenuItem
                  variant="destructive"
                  className="w-full"
                  render={<button type="submit" className="w-full" />}
                >
                  <LogOutIcon aria-hidden="true" />
                  <span>Cerrar sesión</span>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto pb-[var(--shell-bottom-nav-space)]">
        {children}
      </main>
      {viewport.keyboardOpen ? null : (
        <nav
          aria-label="Navegación principal"
          className="bg-background fixed inset-x-0 bottom-0 z-30 grid border-t"
          style={{
            height: "var(--shell-bottom-nav-height)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
            gridTemplateColumns: `repeat(${platformNavSections.length}, minmax(0, 1fr))`,
          }}
        >
          {platformNavSections.map((section) => {
            const active = section.match.paths.some((path) =>
              isPlatformNavPathActive(pathname, path, section.match.mode)
            )
            return (
              <Link
                key={section.key}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 flex-col items-center justify-center gap-0.5 py-1.5"
              >
                <section.icon
                  className={active ? "text-foreground size-5" : "text-muted-foreground size-5"}
                  aria-hidden="true"
                />
                <span
                  className={
                    active
                      ? "text-foreground text-[11px] font-medium"
                      : "text-muted-foreground text-[11px]"
                  }
                >
                  {section.title}
                </span>
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  )
}
