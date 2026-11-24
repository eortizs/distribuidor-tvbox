import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@/components/reui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Tarjeta «Primeros pasos» (§4.4 del plan): pasos pendientes del onboarding
 * en la rama de negocio de /clientes. Solo propietarios; desaparece al
 * completar. El estado se DERIVA (sin banderas): lo que falta aquí es lo que
 * getOnboardingStatus ve incompleto.
 */

export interface GettingStartedSteps {
  mpToken: boolean
  banking: boolean
  whatsapp: boolean
}

const STEP_META = [
  { key: "mpToken", label: "Conectar Mercado Pago", paso: 1 },
  { key: "banking", label: "Cuenta donde recibes", paso: 2 },
  { key: "whatsapp", label: "WhatsApp del negocio", paso: 3 },
] as const

export function GettingStartedCard({ steps }: { steps: GettingStartedSteps }) {
  const pending = STEP_META.filter((step) => !steps[step.key])
  if (pending.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          Primeros pasos
          <Badge variant="warning-light" size="sm">
            {pending.length} pendiente{pending.length > 1 ? "s" : ""}
          </Badge>
        </CardTitle>
        <CardDescription>
          Completa la configuración para que tu negocio cobre solo: confirma
          cada pago y avisa a tus clientes por WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {pending.map((step) => (
          <Link
            key={step.key}
            href={`/onboarding?paso=${step.paso}`}
            className="bg-background border-border text-foreground dark:bg-input/30 inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {step.label}
            <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </Link>
        ))}
        <Link
          href="/onboarding"
          className="text-primary ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Completar configuración
        </Link>
      </CardContent>
    </Card>
  )
}
