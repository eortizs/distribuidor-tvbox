import type { Metadata } from "next"

import { AlertasStudio } from "@/components/herramientas/alertas/alertas-studio"
import { requireUser } from "@/server/auth/guards"
import { alertsConfigured } from "@/server/alertas/llm"
import { vapidPublicKeyForClient } from "@/server/push/service"

export const metadata: Metadata = {
  title: "Alertas",
}

export default async function AlertasPage() {
  await requireUser()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Alertas</h1>
      <AlertasStudio
        llmConfigured={alertsConfigured()}
        vapidPublicKey={vapidPublicKeyForClient()}
      />
    </div>
  )
}
