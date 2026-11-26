import type { Metadata } from "next"

import { WhatsAppView } from "@/components/herramientas/whatsapp/whatsapp-view"
import { requireRole } from "@/server/auth/guards"
import { listUsers } from "@/server/auth/users"
import { whatsappAgentLlmConfigured } from "@/server/whatsapp/config"
import {
  listWhatsAppContacts,
  listWhatsAppLog,
  listWhatsAppOutbox,
} from "@/server/whatsapp/service"
import { getWhatsAppStatus } from "@/server/whatsapp/gateway"
import { LEGACY_TENANT_ID } from "@/server/tenant/identity"
import { findTenantById } from "@/server/tenant/context"
import { whatsappAgentNumber } from "@/server/whatsapp/config"

export const metadata: Metadata = {
  title: "WhatsApp",
}

export default async function WhatsAppPage() {
  const user = await requireRole("propietario", "core")
  // Tenant de la SESIÓN (requireRole → requireUser → getSessionUser): el
  // contexto ALS sync no cruza los awaits de Next de forma fiable.
  const tenantId = user.tenantId ?? null
  const isLegacy = tenantId === LEGACY_TENANT_ID
  // Número del canal: el legado usa el del env; un negocio el que declaró
  // (§4.5 2B). Las partes del agente LLM y de TVBox solo existen en el
  // legado.
  const agentNumber = isLegacy
    ? whatsappAgentNumber()
    : ((await findTenantById(tenantId ?? ""))?.whatsappNumber ?? null)
  const [outbox, log, users, contacts] = await Promise.all([
    listWhatsAppOutbox(),
    listWhatsAppLog(50),
    listUsers(),
    listWhatsAppContacts(),
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
        initialStatus={await getWhatsAppStatus(tenantId ?? "")}
        agentNumber={agentNumber}
        llmConfigured={isLegacy ? whatsappAgentLlmConfigured() : false}
        variant={isLegacy ? "legacy" : "business"}
        initialOutbox={outbox}
        initialLog={log}
        registered={registered}
        initialContacts={contacts}
      />
    </div>
  )
}
