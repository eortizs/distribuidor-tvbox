import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { AsistenteChat } from "@/components/asistente/asistente-chat"
import { assistantAttachmentsConfigured } from "@/server/asistente/attachments"
import { requireUser } from "@/server/auth/guards"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"

export const instant = false

export const metadata: Metadata = {
  title: "Ayuda",
}

/**
 * Sección AYUDA (reestructura de bloques 2026-11-24): en el host de
 * plataforma es el mismo asistente del panel (`assistant_messages`
 * compartido por usuario). En los demás hosts el bloque Ayuda del panel
 * sigue viviendo en `/soporte`: esta ruta redirige allí.
 */
export default async function AyudaPage() {
  const hostKind = resolveTenantHost(await requestHost()).kind
  if (hostKind !== "platform") {
    redirect("/soporte/asistente")
  }
  await requireUser("general")

  return (
    <div className="flex h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space)-var(--shell-section-tabs-height))] flex-col p-4 md:p-6">
      <AsistenteChat attachmentsReady={assistantAttachmentsConfigured()} />
    </div>
  )
}
