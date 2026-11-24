import { AppSplash } from "@/components/app-splash"

export const instant = false

/**
 * Layout del ASISTENTE DE CONFIGURACIÓN (§4.3 del plan): mínimo a propósito
 * — splash + contenido centrado, sin la barra del panel. El negocio recién
 * creado configura aquí sus datos antes de ver el panel completo.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <AppSplash />
      {children}
    </div>
  )
}
