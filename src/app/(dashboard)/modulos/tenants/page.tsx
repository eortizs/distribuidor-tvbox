import { requirePlatformUser } from "@/server/auth/guards"
import { listPlatformTenants } from "@/server/tenants/platform"
import {
  TenantsConsole,
  type PlatformTenantItem,
} from "@/components/plataforma/tenants-console"

export const instant = false

export const metadata = {
  title: "Tenants",
}

const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Mexico_City",
})

/**
 * Módulo «Tenants» del hub de plataforma (`/modulos/tenants`): la consola
 * de negocios — alta con propietario y contraseña temporal, suspender o
 * reactivar el subdominio y restablecer la contraseña del propietario.
 * `requirePlatformUser` responde 404 fuera del host de plataforma o a
 * cualquier rol que no sea plataforma. El regreso al hub lo resuelve la
 * cabecera del shell (backHref `/modulos`).
 */
export default async function PlatformTenantsPage() {
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
    affiliateCode: row.affiliateCode,
    createdAtLabel: DATE_FORMAT.format(row.createdAt),
  }))

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <TenantsConsole tenants={tenants} />
    </div>
  )
}
