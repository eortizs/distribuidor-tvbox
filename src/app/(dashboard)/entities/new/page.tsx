import { EntityForm } from "@/components/entities/entity-form"

export const metadata = {
  title: "New entity",
}

export default function NewEntityPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">New entity</h1>
        <p className="text-muted-foreground text-sm">
          The server assigns the id (UUID v7) and lifecycle timestamps.
        </p>
      </div>
      <EntityForm />
    </div>
  )
}
