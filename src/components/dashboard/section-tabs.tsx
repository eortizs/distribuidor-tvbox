"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"

import {
  findNavSection,
  isNavChildActive,
} from "@/components/dashboard/nav-config"
import { sectionTabClass } from "@/components/dashboard/nav-layout"

/**
 * Pestañas de la sección activa: enlaces reales (cada opción tiene su URL)
 * tomados de `nav-config`, sobre el riel compartido `sectionTabClass`.
 * No renderiza nada fuera de una sección con opciones.
 */
export function SectionTabs() {
  const pathname = usePathname() ?? ""
  const section = findNavSection(pathname)
  const children = section?.children
  /** Una pestaña a pantalla completa (hideTabs) no muestra el riel. */
  const activeChild = children?.find((child) => isNavChildActive(child, pathname))

  if (!section || !children?.length || activeChild?.hideTabs) return null

  return (
    <nav aria-label={section.title} className="shrink-0 border-b">
      <ul className={cn(sectionTabClass.list, "px-4 md:px-6")}>
        {children.map((child) => {
          const active = isNavChildActive(child, pathname)
          return (
            <li key={child.href} className="flex">
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  sectionTabClass.item,
                  active ? sectionTabClass.itemActive : sectionTabClass.itemIdle
                )}
              >
                <child.icon className="size-4" aria-hidden="true" />
                {child.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
