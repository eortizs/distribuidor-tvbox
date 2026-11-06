import Link from "next/link"
import {
  ArrowRightIcon,
  CalculatorIcon,
  ClapperboardIcon,
  ImageIcon,
  type LucideIcon,
} from "lucide-react"

import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface Herramienta {
  title: string
  description: string
  href: string
  icon: LucideIcon
}

/** Catálogo de herramientas publicadas en el hub `/herramientas`. */
const herramientas: Herramienta[] = [
  {
    title: "Imágenes",
    description:
      "Genera y edita imágenes con IA desde texto, referencias o bocetos a mano.",
    href: "/herramientas/imagenes",
    icon: ImageIcon,
  },
  {
    title: "Animación",
    description:
      "Del idea al render con el agente EVE: guiones, storyboards y entregables con costo y tiempo.",
    href: "/herramientas/animacion",
    icon: ClapperboardIcon,
  },
  {
    title: "Calculadora",
    description:
      "Cálculos rápidos con porcentaje comercial, desde botones o teclado.",
    href: "/herramientas/calculadora",
    icon: CalculatorIcon,
  },
]

/**
 * Hub de herramientas: cada una como un tile de app (una Card completa es el
 * enlace), en grilla responsive.
 */
export function ToolLauncher() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {herramientas.map((tool) => (
        <Link
          key={tool.href}
          href={tool.href}
          className="group/link flex rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Card className="w-full transition-colors group-hover/link:bg-muted/40">
            <CardHeader className="gap-3">
              <div
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted [&_svg:not([class*='size-'])]:size-5"
              >
                <tool.icon />
              </div>
              <div className="flex flex-col gap-0.5">
                <CardTitle>{tool.title}</CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </div>
            </CardHeader>
            <CardFooter className="justify-between">
              <span className="text-sm font-medium transition-colors group-hover/link:text-foreground">
                Abrir
              </span>
              <ArrowRightIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-colors group-hover/link:text-foreground"
              />
            </CardFooter>
          </Card>
        </Link>
      ))}
    </div>
  )
}
