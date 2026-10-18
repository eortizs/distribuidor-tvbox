import {
  BotIcon,
  BoxesIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"

export const groupLabels = {
  main: "Inicio",
  herramientas: "Herramientas",
  support: "Support",
} as const

export const navMain = [
  { title: "Dashboard", icon: LayoutDashboardIcon, href: "/" },
  { title: "Entities", icon: BoxesIcon, href: "/entities" },
  {
    title: "Users",
    icon: UsersIcon,
    href: "/users",
    adminOnly: true,
  },
] satisfies {
  title: string
  icon: typeof LayoutDashboardIcon
  href: string
  adminOnly?: boolean
}[]

export const navSecondary = [
  { title: "Asistente", icon: BotIcon, href: "/asistente" },
  { title: "Settings", icon: SettingsIcon },
  { title: "Get help", icon: LifeBuoyIcon },
] satisfies {
  title: string
  icon: typeof LayoutDashboardIcon
  href?: string
}[]

export const herramientasNav = {
  group: groupLabels.herramientas,
  title: "Imágenes",
  href: "/herramientas/imagenes",
  childTitle: "Generador",
} as const

export const profileNav = {
  title: "Perfil",
  href: "/profile",
} as const
