import type { LucideIcon } from "lucide-react"
import {
  BotIcon,
  CircleUserRoundIcon,
  FlaskConicalIcon,
  HouseIcon,
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
 * - `prefix`: el camino exacto o cualquier hijo (`/clientes`, `/clientes/new`,
 *   `/clientes/[id]`). El separador `/` evita falsos positivos como
 *   `/clientes-old`.
 */
export type NavMatchMode = "exact" | "prefix"

export interface NavChild {
  title: string
  icon: LucideIcon
  href: string
  /**
   * La pestaña muestra su rótulo en la cabecera, a la derecha de la
   * mascota, mientras su ruta está activa.
   */
  titleInHeader?: boolean
  /**
   * La pestaña se abre a pantalla completa, sin riel de pestañas: la
   * herramienta ocupa todo el espacio entre cabecera y barra inferior.
   */
  hideTabs?: boolean
}

export interface NavSection {
  title: string
  icon: LucideIcon
  /** Destino del botón de la barra inferior. */
  href: string
  /** Pestañas de la página de la sección, en orden. */
  children?: NavChild[]
  /** Rutas que activan la sección. */
  match: { mode: NavMatchMode; paths: string[] }
  /**
   * La sección muestra su rótulo en la cabecera, a la derecha de la mascota,
   * en lugar de un título propio dentro de la página.
   */
  titleInHeader?: boolean
  /**
   * Ruta de regreso en la cabecera: cuando la ruta activa es más profunda
   * que este hub, se muestra un botón chevron a la izquierda del rótulo que
   * navega aquí.
   */
  backHref?: string
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
 * Soporte. Cada botón navega a la página de su sección (el hub cuando existe);
 * las secciones con opciones las muestran como pestañas dentro de la página
 * (`children`).
 */
export const navSections: NavSection[] = [
  {
    title: "Inicio",
    icon: HouseIcon,
    href: "/",
    match: { mode: "exact", paths: ["/"] },
  },
  {
    title: "Clientes",
    icon: UsersRoundIcon,
    href: "/clientes",
    match: { mode: "prefix", paths: ["/clientes"] },
    titleInHeader: true,
  },
  {
    title: "Herramientas",
    icon: WrenchIcon,
    href: "/herramientas",
    match: { mode: "prefix", paths: ["/herramientas"] },
    titleInHeader: true,
    backHref: "/herramientas",
  },
  {
    title: "Finanzas",
    icon: WalletCardsIcon,
    href: "/finanzas/estado-de-cuenta",
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
    href: "/soporte/asistente",
    match: { mode: "prefix", paths: ["/soporte"] },
    children: [
      { title: "Asistente", icon: BotIcon, href: "/soporte/asistente" },
      {
        title: "Configuración",
        icon: SettingsIcon,
        href: "/soporte/configuracion",
      },
      { title: "Lab", icon: FlaskConicalIcon, href: "/soporte/lab" },
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

export function findNavSection(pathname: string) {
  return navSections.find((section) => isNavSectionActive(section, pathname))
}

/**
 * Rótulo del header para la ruta actual: la sección lo publica con
 * `titleInHeader` y una pestaña concreta también puede hacerlo, con
 * prioridad sobre el rótulo de su sección.
 */
export function findNavHeaderTitle(pathname: string) {
  const section = findNavSection(pathname)
  if (!section) return null
  const child = section.children?.find((child) =>
    isNavChildActive(child, pathname)
  )
  if (child?.titleInHeader) return child.title
  return section.titleInHeader ? section.title : null
}

/**
 * Botón de regreso de la cabecera para la ruta actual: la sección lo publica
 * con `backHref` y solo aplica cuando la ruta activa es más profunda que su
 * hub (el hub mismo no necesita regreso).
 */
export function findNavBack(pathname: string) {
  const section = findNavSection(pathname)
  if (!section?.backHref || pathname === section.backHref) return null
  return { href: section.backHref, title: section.title }
}

export function isNavChildActive(child: NavChild, pathname: string) {
  return isNavPathActive(pathname, child.href, "prefix")
}
