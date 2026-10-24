import { KeyRoundIcon, type LucideIcon } from "lucide-react"

export interface LabModule {
  slug: string
  title: string
  description: string
  href: string
  icon: LucideIcon
  status: "disponible" | "en_pruebas"
}

/**
 * Módulos del laboratorio. Cada uno vive en su propia ruta y se integra en el
 * panel cuando queda listo; la lista es la única fuente para el índice de
 * `/lab` y para la navegación.
 */
export const labModules: LabModule[] = [
  {
    slug: "flujotv",
    title: "API FlujoTV",
    description:
      "Consulta los clientes del panel, revisa el historial de licencias y ejecuta renovaciones contra la API de FlujoTV.",
    href: "/lab/flujotv",
    icon: KeyRoundIcon,
    status: "disponible",
  },
]
