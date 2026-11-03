import type { Metadata } from "next"

import { FlujoLab } from "@/components/lab/flujo-lab"
import { requireUser } from "@/server/auth/guards"
import { getFlujoStatus } from "@/server/flujotv/service"

export const metadata: Metadata = {
  title: "Lab · API FlujoTV",
}

export const instant = false

export default async function LabFlujoTvPage() {
  await requireUser()
  const status = await getFlujoStatus()

  return <FlujoLab initialStatus={status} />
}
