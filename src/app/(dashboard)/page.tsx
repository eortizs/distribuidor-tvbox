import { redirect } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { StatCards } from "@/components/dashboard/stat-cards"
import { Button } from "@/components/ui/button"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"

/**
 * Raíz del panel: en el LEGADO y los negocios es el bloque Inicio de la
 * barra inferior (path `/` en nav-config). En el HOST DE PLATAFORMA el
 * bloque Inicio vive en `/inicio` (reestructura de bloques 2026-11-24): la
 * raíz redirige allí.
 */
export default async function DashboardPage() {
  if (resolveTenantHost(await requestHost()).kind === "platform") {
    redirect("/inicio")
  }
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Store performance at a glance.
          </p>
        </div>
        <Button size="sm">
          <PlusIcon aria-hidden="true" />
          New report
        </Button>
      </div>
      <StatCards />
      <RevenueChart />
    </div>
  )
}
