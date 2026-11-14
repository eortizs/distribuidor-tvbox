import type { Metadata } from "next"

import { AsistenteChat } from "@/components/asistente/asistente-chat"
import { assistantAttachmentsConfigured } from "@/server/asistente/attachments"
import { requireUser } from "@/server/auth/guards"

export const metadata: Metadata = {
  title: "Asistente",
}

export default async function AsistentePage() {
  await requireUser()

  return (
    <div className="flex h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space)-var(--shell-section-tabs-height))] flex-col p-4 md:p-6">
      <AsistenteChat attachmentsReady={assistantAttachmentsConfigured()} />
    </div>
  )
}
