import { isOwnerRole } from "@/server/auth/types"
import type { Metadata } from "next"

import { Calculadora } from "@/components/herramientas/calculadora/calculadora"
import { requireUser } from "@/server/auth/guards"
import { getHiddenModules } from "@/server/modulos/visibility"
import { resolveCreatorBankData } from "@/server/links-pago/bank"
import { whatsappAgentNumber } from "@/server/whatsapp/config"

export const metadata: Metadata = {
  title: "Calculadora",
}

export default async function CalculadoraPage() {
  const user = await requireUser("core")

  // Cobrar comparte la capacidad del módulo SPEILink: si el admin la
  // ocultó para esta cuenta, la calculadora tampoco ofrece cobros (admins
  // siempre pueden).
  const hiddenModules =
    isOwnerRole(user.role) ? null : await getHiddenModules(user.id)
  const puedeCobrar =
    hiddenModules === null ||
    !hiddenModules.includes("/modulos/links-de-pago")

  return (
    <div className="relative mx-auto h-[calc(var(--shell-viewport-height)-var(--shell-header-height)-var(--shell-bottom-nav-space))] min-h-[27.5rem] w-full max-w-xl p-3 sm:p-4">
      <Calculadora
        puedeCobrar={puedeCobrar}
        whatsappConfigured={whatsappAgentNumber() !== null}
        bankConfigured={(await resolveCreatorBankData(user)) !== null}
      />
    </div>
  )
}
