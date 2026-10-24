import Link from "next/link"
import { ImageIcon, KeyRoundIcon } from "lucide-react"
import { cn } from "cn"

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
    href: "/configuracion",
    icon: ImageIcon,
  },
  {
    id: "api-licencias",
    title: "API de licencias",
    href: "/configuracion/api-licencias",
    icon: KeyRoundIcon,
  },
]

/**
 * Menú interno de Configuración: enlaces reales (cada sección tiene su URL)
 * para moverse entre los grupos de ajustes sin recargar el panel.
 */
export function ConfiguracionMenu({
  active,
}: {
  active: ConfiguracionSection
}) {
  return (
    <nav aria-label="Secciones de configuración" className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {SECTIONS.map((section) => {
          const isActive = section.id === active
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  isActive
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent"
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
