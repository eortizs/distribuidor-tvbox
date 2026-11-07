import type { Metadata } from "next"

import { FlujoLab } from "@/components/lab/flujo-lab"
import { requireRole } from "@/server/auth/guards"
import { getFlujoStatus } from "@/server/flujotv/service"

export const metadata: Metadata = {
  title: "Lab · API FlujoTV",
}

export const instant = false

export default async function LabFlujoTvPage() {
  // Solo admin: incluye la consola cruda que permite operar la API de
  // licencias (p. ej. renovaciones) sin pasar por el cobro de Mercado Pago.
  await requireRole("admin")
  const status = await getFlujoStatus()

  return <FlujoLab initialStatus={status} />
}
