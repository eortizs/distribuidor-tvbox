import {
  BotIcon,
  CircleUserRoundIcon,
  ClapperboardIcon,
  CreditCardIcon,
  ImageIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  ReceiptTextIcon,
  SettingsIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UsersRoundIcon,
} from "lucide-react"

export const groupLabels = {
  main: "Inicio",
  herramientas: "Herramientas",
  finanzas: "Finanzas",
  support: "Support",
} as const

export const navMain = [
  { title: "Dashboard", icon: LayoutDashboardIcon, href: "/" },
  { title: "Clientes", icon: UsersRoundIcon, href: "/entities" },
  {
    title: "Usuarios",
    icon: CircleUserRoundIcon,
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
  {
    title: "Configuración",
    icon: SettingsIcon,
    href: "/configuracion",
  },
  { title: "Get help", icon: LifeBuoyIcon },
] satisfies {
  title: string
  icon: typeof LayoutDashboardIcon
  href?: string
}[]

export const herramientasNav = {
  group: groupLabels.herramientas,
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
} as const

export const finanzasNav = {
  group: groupLabels.finanzas,
  children: [
    {
      title: "Estado de cuenta",
      icon: ReceiptTextIcon,
      href: "/finanzas/estado-de-cuenta",
    },
    { title: "Ganancias", icon: TrendingUpIcon, href: "/finanzas/ganancias" },
    { title: "Gastos", icon: TrendingDownIcon, href: "/finanzas/gastos" },
    {
      title: "Método de pago",
      icon: CreditCardIcon,
      href: "/finanzas/metodo-de-pago",
    },
  ],
} as const

export const profileNav = {
  title: "Perfil",
  href: "/profile",
} as const
