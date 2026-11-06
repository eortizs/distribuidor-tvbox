"use client"

/**
 * Pantalla Herramientas (`/herramientas`): listado de herramientas compuesto
 * con el mismo acordeón de la pantalla Clientes (`c-accordion-9` de ReUI,
 * una fila por herramienta, una sola abierta a la vez):
 *
 * - Fila: icono de la herramienta en tile (`size-12`, `bg-muted`); como
 *   título, el nombre y, como subtítulo, la breve descripción. La fila
 *   completa es un enlace real a la herramienta: al pulsarla se ejecuta.
 * - Al margen derecho, el botón settings-2 de lucide: es el trigger del
 *   acordeón y, al pulsarlo, despliega las opciones de la herramienta.
 * - Contenido expandido: dos botones en lista, **maquetas sin
 *   funcionalidad por ahora** — «Configurar» (fantasma, con icono de
 *   controles) y «Eliminar» (variante destructive, separada del resto).
 */

import Link from "next/link"
import {
  CalculatorIcon,
  ClapperboardIcon,
  ImageIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TrashIcon,
  type LucideIcon,
} from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

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

export function HerramientasAccordion() {
  return (
    <Accordion multiple={false}>
      {herramientas.map((tool) => (
        <AccordionItem
          key={tool.href}
          value={tool.href}
          className="bg-transparent p-0"
        >
          <div className="flex items-center">
            <Link
              href={tool.href}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-2.5 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50"
            >
              <div
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6"
              >
                <tool.icon />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                <span className="truncate text-base font-semibold tracking-tight">
                  {tool.title}
                </span>
                <span className="text-muted-foreground line-clamp-2 text-left text-xs">
                  {tool.description}
                </span>
              </div>
            </Link>
            <AccordionTrigger
              aria-label={`Opciones de ${tool.title}`}
              className="mr-1.5 size-11 shrink-0 flex-none items-center justify-center rounded-full border-transparent p-0 text-muted-foreground hover:bg-muted hover:no-underline focus-visible:border-transparent dark:hover:bg-muted/50 aria-expanded:bg-muted dark:aria-expanded:bg-muted/50 [&_[data-slot=accordion-trigger-icon]]:hidden"
            >
              <Settings2Icon aria-hidden="true" className="size-5" />
            </AccordionTrigger>
          </div>
          <AccordionContent className="text-muted-foreground py-0 pr-1.5 pl-16.5">
            <div className="flex flex-col items-stretch gap-1 pb-1">
              <Button type="button" variant="ghost" size="lg" className="w-full max-w-56 justify-start">
                <SlidersHorizontalIcon aria-hidden="true" />
                Configurar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="w-full max-w-56 justify-start"
              >
                <TrashIcon aria-hidden="true" />
                Eliminar
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
