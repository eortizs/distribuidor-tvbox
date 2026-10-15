import { PlusIcon } from "lucide-react"

import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { StatCards } from "@/components/dashboard/stat-cards"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
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
