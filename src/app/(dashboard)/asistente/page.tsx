import type { Metadata } from "next"

import { AsistenteChat } from "@/components/asistente/asistente-chat"

export const metadata: Metadata = {
  title: "Asistente",
}

export default function AsistentePage() {
  return (
    <div className="flex h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space))] flex-col p-4 md:p-6">
      <AsistenteChat />
    </div>
  )
}
