import type { Metadata } from "next"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { FlaskConicalIcon } from "lucide-react"

export const metadata: Metadata = {
  title: "Lab",
}

export default function LabPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Lab</h1>
        <p className="text-muted-foreground text-sm">
          Espacio de pruebas y experimentos del panel.
        </p>
      </div>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlaskConicalIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>El laboratorio está vacío</EmptyTitle>
          <EmptyDescription>
            Aquí aparecerán los módulos en prueba, uno a uno.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
