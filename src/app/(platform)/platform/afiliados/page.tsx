import { redirect } from "next/navigation"

/** `/platform/afiliados` → `/modulos/afiliados` (307): reestructura 2026-11-24. */
export default function LegacyPlatformAffiliatesRedirect() {
  redirect("/modulos/afiliados")
}
