import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon } from "lucide-react"

/**
 * Regreso flotante al hub de herramientas: solo chevron sobre un disco
 * circular semi-transparente (20 % de transparencia) en la esquina
 * superior izquierda de la zona visible bajo la cabecera.
 */
export function CalculadoraBackLink() {
  return (
    <nav
      aria-label="Regreso a Herramientas"
      className="absolute top-4 left-4 z-10"
    >
      <Button
        variant="ghost"
        size="icon-lg"
        className="size-13.5 rounded-full bg-background/80 backdrop-blur-sm"
        render={<Link href="/herramientas" />}
        nativeButton={false}
        aria-label="Regresar al menú de Herramientas"
      >
        <ChevronLeftIcon className="size-6" aria-hidden="true" />
      </Button>
    </nav>
  )
}
