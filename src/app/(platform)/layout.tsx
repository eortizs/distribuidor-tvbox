import { AppSplash } from "@/components/app-splash"

export const instant = false

/**
 * Layout del grupo de la CONSOLA DE PLATAFORMA: mínimo a propósito — sin el
 * shell del panel ni navegación de negocio (el operador de plataforma no
 * pertenece a ningún tenant). El splash vive aquí (como en el grupo del
 * panel) para que la landing y login jamás lo monten; viste SPEILink (la
 * marca del host).
 */
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <AppSplash logo="speilink" />
      {children}
    </div>
  )
}
