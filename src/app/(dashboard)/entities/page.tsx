import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { EntityList } from "@/components/entities/entity-list"
import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Entities",
}

export default function EntitiesPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Entities</h1>
          <p className="text-muted-foreground text-sm">
            umeJSON entities persisted in PostgreSQL.
          </p>
        </div>
        <Button size="sm" render={<Link href="/entities/new" />}>
          <PlusIcon aria-hidden="true" />
          New entity
        </Button>
      </div>
      <EntityList />
    </div>
  )
}
