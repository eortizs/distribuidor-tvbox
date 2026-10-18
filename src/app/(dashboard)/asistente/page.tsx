import type { Metadata } from "next"

import { AsistenteChat } from "@/components/asistente/asistente-chat"

export const metadata: Metadata = {
  title: "Asistente",
}

export default function AsistentePage() {
  return (
    <div className="flex h-[calc(100svh-4rem)] flex-col p-4 md:p-6">
      <AsistenteChat />
    </div>
  )
}
