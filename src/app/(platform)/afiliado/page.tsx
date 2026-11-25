import { redirect } from "next/navigation"

/**
 * `/afiliado` → `/inicio` (307): el portal del afiliado se reestructuró
 * (2026-11-24) en las secciones del host de plataforma — su enlace y cifras
 * viven en Inicio y sus negocios referidos en Clientes.
 */
export default function LegacyAfiliadoRedirect() {
  redirect("/inicio")
}
