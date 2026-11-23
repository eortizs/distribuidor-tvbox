import { notFound } from "next/navigation"

import { requirePlatformUser } from "@/server/auth/guards"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"
import { listPlatformTenants } from "@/server/tenants/platform"
import { PlatformConsole, type PlatformTenantItem } from "@/components/plataforma/platform-console"

export const instant = false

export const metadata = {
  title: "Consola de plataforma",
}

/**
 * Consola de plataforma (§2.4): SOLO el host platform.spei.link y SOLO rol
 * `plataforma`. En cualquier otro host responde 404 neutro.
 */
export default async function PlatformPage() {
  const hostKind = resolveTenantHost(await requestHost()).kind
  if (hostKind !== "platform") {
    notFound()
  }
  await requirePlatformUser()

  const rows = await listPlatformTenants()
  const tenants: PlatformTenantItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    status: row.status,
    whatsappNumber: row.whatsappNumber,
    ownerEmail: row.ownerEmail,
    userCount: row.userCount,
    createdAtLabel: new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "America/Mexico_City",
    }).format(row.createdAt),
  }))

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <PlatformConsole tenants={tenants} />
    </div>
  )
}
