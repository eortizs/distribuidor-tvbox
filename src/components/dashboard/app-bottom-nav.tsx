"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"

import {
  isNavSectionActive,
  navSections,
  type NavSection,
} from "@/components/dashboard/nav-config"
import { bottomNavClass } from "@/components/dashboard/nav-layout"

/**
 * Barra inferior de cinco destinos, fija y persistente. Cada botón navega a
 * su propia página; las secciones con opciones muestran sus pestañas dentro
 * de la página.
 */
export function AppBottomNav() {
  const pathname = usePathname() ?? ""

  return (
    <nav
      aria-label="Navegación principal"
      className={bottomNavClass.bar}
      style={{
        height: "var(--shell-bottom-nav-height)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className={bottomNavClass.grid}>
        {navSections.map((section) => (
          <BottomNavLink key={section.title} section={section} pathname={pathname} />
        ))}
      </div>
    </nav>
  )
}

function BottomNavLink({
  section,
  pathname,
}: {
  section: NavSection
  pathname: string
}) {
  const active = isNavSectionActive(section, pathname)

  return (
    <Link
      href={section.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        bottomNavClass.item,
        active ? bottomNavClass.itemActive : bottomNavClass.itemIdle
      )}
    >
      <section.icon className={bottomNavClass.icon} aria-hidden="true" />
      <span className={bottomNavClass.label}>{section.title}</span>
    </Link>
  )
}
