"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"

import {
  isNavChildActive,
  isNavSectionActive,
  navSections,
  type NavSection,
} from "@/components/dashboard/nav-config"
import { bottomNavClass, mobileNavClass } from "@/components/dashboard/nav-layout"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Barra inferior de cinco destinos, fija y persistente. Los destinos directos
 * son enlaces; los agrupados abren un menú ascendente.
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
        {navSections.map((section) =>
          section.kind === "link" ? (
            <BottomNavLink key={section.title} section={section} pathname={pathname} />
          ) : (
            <BottomNavMenu key={section.title} section={section} pathname={pathname} />
          )
        )}
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
      href={section.href ?? "/"}
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

function BottomNavMenu({
  section,
  pathname,
}: {
  section: NavSection
  pathname: string
}) {
  const active = isNavSectionActive(section, pathname)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-current={active ? "page" : undefined}
        className={cn(
          bottomNavClass.item,
          active ? bottomNavClass.itemActive : bottomNavClass.itemIdle
        )}
      >
        <section.icon className={bottomNavClass.icon} aria-hidden="true" />
        <span className={bottomNavClass.label}>{section.title}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={8}
        className={cn(mobileNavClass.dropdownContent, "w-56")}
      >
        {(section.children ?? []).map((child) => {
          const childActive = isNavChildActive(child, pathname)
          return (
            <DropdownMenuItem
              key={child.href}
              render={<Link href={child.href} />}
              aria-current={childActive ? "page" : undefined}
              className={cn(
                mobileNavClass.dropdownItem,
                childActive && "bg-muted text-foreground"
              )}
            >
              <child.icon aria-hidden="true" />
              <span>{child.title}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
