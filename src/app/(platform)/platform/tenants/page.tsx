import { redirect } from "next/navigation"

/** `/platform/tenants` → `/modulos/tenants` (307): reestructura 2026-11-24. */
export default function LegacyPlatformTenantsRedirect() {
  redirect("/modulos/tenants")
}
