import {
  BuildingIcon,
  Share2Icon,
  type LucideIcon,
} from "lucide-react"

/**
 * Catálogo del hub de módulos de la CONSOLA DE PLATAFORMA
 * (`platform.spei.link/platform`), mismo patrón que el hub `/modulos` del
 * panel (`src/lib/modulos.ts`) pero con su propio catálogo: los hrefs son
 * del host de plataforma y NO participan en el catálogo ajustable del panel
 * (user_module_permissions) ni en las preferencias del legado.
 *
 * El componente cliente importa este módulo DIRECTAMENTE (el hub vive entero
 * del lado cliente): sin frontera RSC, los iconos no necesitan proyección
 * serializable (regla React 441 solo aplica servidor→cliente).
 */

export interface PlatformModulo {
  title: string
  description: string
  href: string
  icon: LucideIcon
}

export const PLATFORM_MODULOS: PlatformModulo[] = [
  {
    title: "Tenants",
    description:
      "Alta de negocios con propietario y contraseña temporal, suspender o reactivar el subdominio y restablecer la contraseña del propietario.",
    href: "/modulos/tenants",
    icon: BuildingIcon,
  },
  {
    title: "Afiliados",
    description:
      "Alta de afiliados con su enlace spei.link/afiliado/CÓDIGO, clics, negocios registrados, suspender el enlace y restablecer su contraseña.",
    href: "/modulos/afiliados",
    icon: Share2Icon,
  },
]

const PLATFORM_MODULOS_BY_HREF = new Map(
  PLATFORM_MODULOS.map((modulo) => [modulo.href, modulo])
)

/** Re-atacha el icono por href (fuente única del catálogo). */
export function platformModuloByHref(href: string): PlatformModulo | null {
  return PLATFORM_MODULOS_BY_HREF.get(href) ?? null
}
