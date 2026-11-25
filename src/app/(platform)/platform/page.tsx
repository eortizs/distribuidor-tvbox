import { redirect } from "next/navigation"

/**
 * `/platform` → `/inicio` (307): la consola de plataforma se reestructuró
 * (2026-11-24) en los cinco bloques del panel (inicio, módulos, clientes,
 * finanzas, ayuda); el hub de módulos vive en `/modulos` y el destino
 * tras iniciar sesión es `/inicio`.
 */
export default function LegacyPlatformRedirect() {
  redirect("/inicio")
}
