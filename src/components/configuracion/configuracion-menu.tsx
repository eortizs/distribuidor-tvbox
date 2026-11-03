import Link from "next/link"
import { ImageIcon, KeyRoundIcon } from "lucide-react"
import { cn } from "cn"

import { sectionTabClass } from "@/components/dashboard/nav-layout"

export type ConfiguracionSection = "modelos-imagen" | "api-licencias"

const SECTIONS: {
  id: ConfiguracionSection
  title: string
  href: string
  icon: typeof ImageIcon
}[] = [
  {
    id: "modelos-imagen",
    title: "Modelos de imagen",
    href: "/soporte/configuracion",
    icon: ImageIcon,
  },
  {
    id: "api-licencias",
    title: "API de licencias",
    href: "/soporte/configuracion/api-licencias",
    icon: KeyRoundIcon,
  },
]

/**
 * Menú interno de Configuración: enlaces reales (cada sección tiene su URL)
 * para moverse entre los grupos de ajustes sin recargar el panel. Usa el
 * mismo riel de pestañas que las secciones de la barra inferior.
 */
export function ConfiguracionMenu({
  active,
}: {
  active: ConfiguracionSection
}) {
  return (
    <nav aria-label="Secciones de configuración" className="border-b">
      <ul className={sectionTabClass.list}>
        {SECTIONS.map((section) => {
          const isActive = section.id === active
          return (
            <li key={section.id} className="flex">
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  sectionTabClass.item,
                  isActive
                    ? sectionTabClass.itemActive
                    : sectionTabClass.itemIdle
                )}
              >
                <section.icon className="size-4" aria-hidden="true" />
                {section.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
