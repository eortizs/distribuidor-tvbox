import { SectionTabs } from "@/components/dashboard/section-tabs"

/**
 * Envoltura de las páginas de una sección con opciones: pestañas en la
 * parte superior y el contenido de la pestaña activa debajo. El alto de la
 * fila de pestañas queda publicado en `--shell-section-tabs-height` para
 * las páginas de alto fijo.
 */
export function SectionTabsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col">
      <SectionTabs />
      {children}
    </div>
  )
}
