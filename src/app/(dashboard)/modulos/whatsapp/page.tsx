import type { Metadata } from "next"

import { WhatsAppView } from "@/components/herramientas/whatsapp/whatsapp-view"
import { requireRole } from "@/server/auth/guards"
import { listUsers } from "@/server/auth/users"
import {
  whatsappAgentLlmConfigured,
  whatsappAgentNumber,
} from "@/server/whatsapp/config"
import { listWhatsAppLog, listWhatsAppOutbox } from "@/server/whatsapp/service"
import { getWhatsAppStatus } from "@/server/whatsapp/socket"

export const metadata: Metadata = {
  title: "WhatsApp",
}

export default async function WhatsAppPage() {
  await requireRole("admin")
  const [outbox, log, users] = await Promise.all([
    listWhatsAppOutbox(),
    listWhatsAppLog(50),
    listUsers(),
  ])

  const registered = users
    .filter((user) => user.whatsappPhone)
    .map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      phone: user.whatsappPhone as string,
    }))

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">WhatsApp</h1>
      <WhatsAppView
        initialStatus={getWhatsAppStatus()}
        agentNumber={whatsappAgentNumber()}
        llmConfigured={whatsappAgentLlmConfigured()}
        initialOutbox={outbox}
        initialLog={log}
        registered={registered}
      />
    </div>
  )
}
