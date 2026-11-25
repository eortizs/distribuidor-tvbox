import { requirePlatformUser } from "@/server/auth/guards"
import { listAffiliates } from "@/server/afiliados/repository"
import { affiliateLinkUrl } from "@/lib/afiliados"
import { shortLinkBaseUrl } from "@/server/site-url"
import {
  AffiliatesConsole,
  type AffiliateItem,
} from "@/components/plataforma/afiliados-console"

export const instant = false

export const metadata = {
  title: "Afiliados",
}

const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Mexico_City",
})

/**
 * Módulo «Afiliados» del hub de plataforma (`/modulos/afiliados`): alta de
 * afiliados con su enlace spei.link/afiliado/CÓDIGO, clics, negocios
 * registrados, suspender el enlace y restablecer la contraseña.
 * `requirePlatformUser` responde 404 fuera del host de plataforma.
 */
export default async function PlatformAffiliatesPage() {
  await requirePlatformUser()

  const affiliateRows = await listAffiliates().catch(() => [])
  const affiliates: AffiliateItem[] = affiliateRows.map((row) => ({
    id: row.id,
    code: row.code,
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    clickCount: row.clickCount,
    signupCount: row.signupCount,
    link: affiliateLinkUrl(row.code, shortLinkBaseUrl()),
    createdAtLabel: DATE_FORMAT.format(row.createdAt),
  }))

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <AffiliatesConsole affiliates={affiliates} />
    </div>
  )
}
