import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@/components/reui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { labModules } from "@/lib/lab"
import { requireUser } from "@/server/auth/guards"

export const metadata: Metadata = {
  title: "Lab",
}

export const instant = false

export default async function LabPage() {
  await requireUser()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Laboratorio</h1>
        <p className="text-muted-foreground text-sm">
          Módulos en prueba del panel. Cada uno se integra en el panel cuando
          queda listo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {labModules.map((module) => (
          <Link
            key={module.slug}
            href={module.href}
            className="group/module rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="h-full transition-colors group-hover/module:ring-ring/40">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <module.icon
                    className="text-muted-foreground size-4"
                    aria-hidden="true"
                  />
                  <CardTitle>{module.title}</CardTitle>
                </div>
                <CardDescription>{module.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <Badge
                  variant={
                    module.status === "disponible"
                      ? "success-light"
                      : "warning-light"
                  }
                  size="sm"
                >
                  {module.status === "disponible"
                    ? "Disponible"
                    : "En pruebas"}
                </Badge>
                <ArrowRightIcon
                  className="text-muted-foreground size-4 transition-colors group-hover/module:text-foreground"
                  aria-hidden="true"
                />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
