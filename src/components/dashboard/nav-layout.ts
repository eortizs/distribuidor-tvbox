/**
 * Medidas compartidas del shell del dashboard (cabecera, barra inferior y
 * menús). Los componentes de `src/components/ui` no se reestilizan: aquí solo
 * viven las clases que el shell necesita.
 */
export const shellLayout = {
  /** Altura de la cabecera, sin contar el safe area superior. */
  headerHeight: "4rem",
  /** Altura de la barra inferior, sin contar el safe area inferior. */
  bottomNavHeight: "4rem",
  /**
   * Pérdida de alto (px) del viewport visual respecto al layout viewport que
   * se considera teclado virtual abierto.
   */
  keyboardThreshold: 150,
} as const

/** Escala táctil de los menús: en móvil cada fila mide 48 px de alto. */
export const mobileNavClass = {
  dropdownContent: "w-64 md:w-56",
  dropdownItem:
    "min-h-12 gap-2 px-3 py-2.5 text-base md:min-h-0 md:gap-1.5 md:px-1.5 md:py-1 md:text-sm [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
  dropdownRadioItem:
    "min-h-12 py-2.5 pl-3 text-base md:min-h-0 md:py-1 md:pl-1.5 md:text-sm [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
  dropdownSubTrigger:
    "min-h-12 gap-2 px-3 py-2.5 text-base md:min-h-0 md:gap-1.5 md:px-1.5 md:py-1 md:text-sm [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
  dropdownSubContent: "w-40 md:w-32",
} as const

/** Composición de la barra inferior de cinco destinos. */
export const bottomNavClass = {
  bar: "bg-background border-border fixed inset-x-0 bottom-0 z-40 border-t",
  grid: "mx-auto grid h-full max-w-2xl grid-cols-5",
  item:
    "flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-lg px-0 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
  itemActive: "bg-muted text-foreground",
  itemIdle: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  icon: "size-5",
  label: "text-xs leading-tight tracking-tight whitespace-nowrap",
} as const
