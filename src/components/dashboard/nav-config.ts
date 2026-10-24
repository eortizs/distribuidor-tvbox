import type { LucideIcon } from "lucide-react"
import {
  BotIcon,
  CircleUserRoundIcon,
  ClapperboardIcon,
  HouseIcon,
  ImageIcon,
  LifeBuoyIcon,
  ReceiptTextIcon,
  SettingsIcon,
  TrendingDownIcon,
  UsersRoundIcon,
  WalletCardsIcon,
  WrenchIcon,
} from "lucide-react"

/**
 * Coincidencia de rutas:
 * - `exact`: solo el camino exacto cuenta (la raíz `/`).
 * - `prefix`: el camino exacto o cualquier hijo (`/entities`, `/entities/new`,
 *   `/entities/[id]`). El separador `/` evita falsos positivos como
 *   `/entities-old`.
 */
export type NavMatchMode = "exact" | "prefix"

export interface NavChild {
  title: string
  icon: LucideIcon
  href: string
}

export interface NavSection {
  title: string
  icon: LucideIcon
  /** `link`: navega directo; `menu`: abre un menú ascendente. */
  kind: "link" | "menu"
  /** Destino de las secciones de tipo enlace. */
  href?: string
  /** Entradas de las secciones agrupadas. */
  children?: NavChild[]
  /** Rutas que activan la sección. */
  match: { mode: NavMatchMode; paths: string[] }
}

export interface NavAccountItem {
  title: string
  icon: LucideIcon
  href: string
  adminOnly?: boolean
}

/**
 * Única fuente de verdad de la navegación. El orden de este arreglo es el
 * orden de la barra inferior: Inicio, Clientes, Herramientas, Finanzas,
 * Soporte.
 */
export const navSections: NavSection[] = [
  {
    title: "Inicio",
    icon: HouseIcon,
    kind: "link",
    href: "/",
    match: { mode: "exact", paths: ["/"] },
  },
  {
    title: "Clientes",
    icon: UsersRoundIcon,
    kind: "link",
    href: "/entities",
    match: { mode: "prefix", paths: ["/entities"] },
  },
  {
    title: "Herramientas",
    icon: WrenchIcon,
    kind: "menu",
    match: { mode: "prefix", paths: ["/herramientas"] },
    children: [
      {
        title: "Imágenes",
        icon: ImageIcon,
        href: "/herramientas/imagenes",
      },
      {
        title: "Animación",
        icon: ClapperboardIcon,
        href: "/herramientas/animacion",
      },
    ],
  },
  {
    title: "Finanzas",
    icon: WalletCardsIcon,
    kind: "menu",
    match: { mode: "prefix", paths: ["/finanzas"] },
    children: [
      {
        title: "Estado de cuenta",
        icon: ReceiptTextIcon,
        href: "/finanzas/estado-de-cuenta",
      },
      {
        title: "Gastos",
        icon: TrendingDownIcon,
        href: "/finanzas/gastos",
      },
    ],
  },
  {
    title: "Soporte",
    icon: LifeBuoyIcon,
    kind: "menu",
    match: { mode: "prefix", paths: ["/asistente", "/configuracion"] },
    children: [
      { title: "Asistente", icon: BotIcon, href: "/asistente" },
      {
        title: "Configuración",
        icon: SettingsIcon,
        href: "/configuracion",
      },
    ],
  },
]

/** Entradas del menú de cuenta (avatar de la cabecera). */
export const accountNav: NavAccountItem[] = [
  {
    title: "Perfil",
    icon: CircleUserRoundIcon,
    href: "/profile",
  },
  {
    title: "Usuarios",
    icon: UsersRoundIcon,
    href: "/users",
    adminOnly: true,
  },
]

export function isNavPathActive(
  pathname: string,
  href: string,
  mode: NavMatchMode
) {
  if (mode === "exact") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function isNavSectionActive(section: NavSection, pathname: string) {
  return section.match.paths.some((path) =>
    isNavPathActive(pathname, path, section.match.mode)
  )
}

export function isNavChildActive(child: NavChild, pathname: string) {
  return isNavPathActive(pathname, child.href, "prefix")
}
