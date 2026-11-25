import {
  ChartNoAxesCombinedIcon,
  HandHelpingIcon,
  HouseIcon,
  LayersIcon,
  UsersRoundIcon,
} from "lucide-react"

import type { NavSection } from "@/components/dashboard/nav-config"

/**
 * Única fuente de verdad de la navegación del HOST DE PLATAFORMA
 * (`platform.spei.link`): los mismos cinco bloques que el panel legado
 * (Inicio, Módulos, Clientes, Finanzas, Ayuda — mismas claves) con las rutas
 * del host de plataforma. `Inicio` vive en `/inicio` (decisión 2026-11-24),
 * no en la raíz. La estructura la comparten los DOS perfiles del host
 * (plataforma y afiliado): las diferencias están en el contenido de cada
 * sección (módulos por perfil y clientes segmentados), no en el nav.
 */
export const platformNavSections: NavSection[] = [
  {
    key: "inicio",
    title: "Inicio",
    icon: HouseIcon,
    href: "/inicio",
    match: { mode: "exact", paths: ["/inicio"] },
  },
  {
    key: "modulos",
    title: "Módulos",
    icon: LayersIcon,
    href: "/modulos",
    match: { mode: "prefix", paths: ["/modulos"] },
    titleInHeader: true,
    backHref: "/modulos",
  },
  {
    key: "clientes",
    title: "Clientes",
    icon: UsersRoundIcon,
    href: "/clientes",
    match: { mode: "prefix", paths: ["/clientes"] },
    titleInHeader: true,
  },
  {
    key: "finanzas",
    title: "Finanzas",
    icon: ChartNoAxesCombinedIcon,
    href: "/finanzas",
    match: { mode: "prefix", paths: ["/finanzas"] },
    titleInHeader: true,
  },
  {
    key: "ayuda",
    title: "Ayuda",
    icon: HandHelpingIcon,
    href: "/ayuda",
    match: { mode: "prefix", paths: ["/ayuda"] },
    titleInHeader: true,
  },
]

export function isPlatformNavPathActive(
  pathname: string,
  href: string,
  mode: NavSection["match"]["mode"]
) {
  if (mode === "exact") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function findPlatformNavSection(pathname: string) {
  return platformNavSections.find((section) =>
    section.match.paths.some((path) =>
      isPlatformNavPathActive(pathname, path, section.match.mode)
    )
  )
}

/**
 * Rótulo del header para la ruta actual: la sección lo publica con
 * `titleInHeader`; los módulos concretos (`/modulos/tenants`) ganan sobre el
 * rótulo del hub, igual que en el panel.
 */
export function findPlatformNavHeaderTitle(
  pathname: string,
  modulos: { title: string; href: string }[]
): string | null {
  const section = findPlatformNavSection(pathname)
  if (!section) return null
  if (section.key === "modulos") {
    const modulo = modulos.find(
      (modulo) =>
        pathname === modulo.href || pathname.startsWith(`${modulo.href}/`)
    )
    if (modulo) return modulo.title
  }
  return section.titleInHeader ? section.title : null
}

/** Regreso de cabecera para rutas más profundas que el hub de la sección. */
export function findPlatformNavBack(pathname: string) {
  const section = findPlatformNavSection(pathname)
  if (!section?.backHref || pathname === section.backHref) return null
  return { href: section.backHref, title: section.title }
}
