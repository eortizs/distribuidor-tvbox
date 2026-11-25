import { redirect } from "next/navigation"
import { PiggyBankIcon } from "lucide-react"

import { Frame, FrameDescription, FrameHeader, FrameTitle } from "@/components/reui/frame"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"

/**
 * Sección FINANZAS (reestructura de bloques 2026-11-24): en el host de
 * plataforma es un bloque del nav SIN contenido aún — se llena cuando exista
 * el modelo financiero de plataforma/afiliados (comisiones); estado vacío
 * explícito, sin maquetas. En los demás hosts el bloque Finanzas del panel
 * sigue viviendo en `/finanzas/estado-de-cuenta`: esta ruta redirige allí.
 */
export default async function FinanzasHubPage() {
  if (resolveTenantHost(await requestHost()).kind === "platform") {
    return (
      <div className="flex flex-1 flex-col p-4 md:p-6">
        <Frame>
          <FrameHeader className="flex flex-col gap-1">
            <FrameTitle>Finanzas</FrameTitle>
            <FrameDescription>
              Aún no hay información financiera para tu perfil. Cuando exista,
              verás aquí tus movimientos y comisiones.
            </FrameDescription>
          </FrameHeader>
          <div
            className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center"
            role="status"
          >
            <PiggyBankIcon aria-hidden="true" className="text-muted-foreground size-8" />
            <p className="text-muted-foreground max-w-sm text-sm">
              Este bloque se activará próximamente.
            </p>
          </div>
        </Frame>
      </div>
    )
  }
  redirect("/finanzas/estado-de-cuenta")
}
