import {
  CalculatorIcon,
  ClapperboardIcon,
  ImageIcon,
  PackageIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  ShoppingBasketIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * Catálogo del hub de módulos (`/modulos`), compartido por el cliente
 * (listado) y el servidor (validación de preferencias): una sola fuente
 * para los hrefs válidos.
 */

export interface ModuloFiltro {
  id: string
  name: string
}

/** Módulo (href) → ids de filtros a los que pertenece. */
export type Asignaciones = Record<string, string[]>

export interface ModulePrefs {
  favorites: string[]
  categories: ModuloFiltro[]
  assignments: Asignaciones
}

export interface Modulo {
  title: string
  description: string
  href: string
  icon: LucideIcon
}

export const MODULOS: Modulo[] = [
  {
    title: "Imágenes",
    description:
      "Genera y edita imágenes con IA desde texto, referencias o bocetos a mano.",
    href: "/modulos/imagenes",
    icon: ImageIcon,
  },
  {
    title: "Animación",
    description:
      "Del idea al render con el agente EVE: guiones, storyboards y entregables con costo y tiempo.",
    href: "/modulos/animacion",
    icon: ClapperboardIcon,
  },
  {
    title: "Calculadora",
    description:
      "Cálculos rápidos con porcentaje comercial, desde botones o teclado.",
    href: "/modulos/calculadora",
    icon: CalculatorIcon,
  },
  {
    title: "Lista de compras",
    description:
      "Dicta o escribe tu lista con IA: productos por categoría, cantidades y casillas de comprado.",
    href: "/modulos/lista-de-compras",
    icon: ShoppingBasketIcon,
  },
  {
    title: "Paquetes FlujoTV",
    description:
      "Renueva licencias en paquetes de 3, 6 y 12 meses con meses de regalo y los mismos métodos de pago.",
    href: "/modulos/paquetes-flujotv",
    icon: PackageIcon,
  },
  {
    title: "Alta de tickets",
    description:
      "Toma una foto del ticket o elige un archivo y la IA extrae sus datos para revisarlos y confirmarlos.",
    href: "/modulos/alta-de-tickets",
    icon: ReceiptTextIcon,
  },
  {
    title: "Abonar saldo",
    description:
      "Define el monto y abona a tu cuenta con Mercado Pago, transferencia o cupón, el mismo checkout de siempre.",
    href: "/modulos/abonar-saldo",
    icon: PiggyBankIcon,
  },
]

const MODULO_HREFS = new Set(MODULOS.map((modulo) => modulo.href))

export const MODULO_PREFS_EMPTY: ModulePrefs = {
  favorites: [],
  categories: [],
  assignments: {},
}

/**
 * Valida la forma de unas preferencias y suelta lo desconocido: favoritos de
 * módulos inexistentes, filtros sin nombre y asignaciones a filtros que ya
 * no existen. Compartida por cliente (migración desde localStorage) y
 * servidor (guardado), así que ambos aceptan exactamente lo mismo.
 */
export function normalizeModulePrefs(input: unknown): ModulePrefs {
  if (!input || typeof input !== "object") return { ...MODULO_PREFS_EMPTY }
  const raw = input as {
    favorites?: unknown
    categories?: unknown
    assignments?: unknown
  }
  const favorites = Array.isArray(raw.favorites)
    ? [
        ...new Set(
          raw.favorites.filter(
            (value): value is string =>
              typeof value === "string" && MODULO_HREFS.has(value)
          )
        ),
      ]
    : []
  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .map((item) => {
          if (!item || typeof item !== "object") return null
          const { id, name } = item as { id?: unknown; name?: unknown }
          if (typeof id !== "string" || id === "") return null
          if (typeof name !== "string" || name.trim() === "") return null
          return { id, name: name.trim().slice(0, 40) }
        })
        .filter((item): item is ModuloFiltro => item !== null)
    : []
  const ids = new Set(categories.map((category) => category.id))
  const assignments: Asignaciones = {}
  if (raw.assignments && typeof raw.assignments === "object") {
    for (const [href, list] of Object.entries(
      raw.assignments as Record<string, unknown>
    )) {
      if (!MODULO_HREFS.has(href) || !Array.isArray(list)) continue
      const clean = [
        ...new Set(
          list.filter(
            (value): value is string => typeof value === "string" && ids.has(value)
          )
        ),
      ]
      if (clean.length > 0) assignments[href] = clean
    }
  }
  return { favorites, categories, assignments }
}

/** Igualdad estructural canónica para comparar snapshots de preferencias. */
export function modulePrefsEqual(
  a: ModulePrefs | null,
  b: ModulePrefs | null
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}
