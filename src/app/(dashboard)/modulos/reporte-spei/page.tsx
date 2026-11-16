import type { Metadata } from "next"

import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { ReporteSpeiView } from "@/components/herramientas/reporte-spei/reporte-spei-view"
import { requireRole } from "@/server/auth/guards"
import {
  cdmxToday,
  listSpeiDepositsForDay,
  speiReportConfigured,
  type SpeiDayReport,
} from "@/server/mercadopago/spei"

export const metadata: Metadata = {
  title: "Reporte SPEI",
}

export default async function ReporteSpeiPage() {
  await requireRole("admin")

  const today = cdmxToday()

  if (!speiReportConfigured()) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <h1 className="sr-only">Reporte SPEI</h1>
        <Frame spacing="default" className="w-full">
          <FrameHeader>
            <FrameTitle className="text-xl font-semibold">
              Reporte SPEI
            </FrameTitle>
            <FrameDescription>
              Depósitos por transferencia bancaria (SPEI a la CLABE)
              acreditados en Mercado Pago, por día.
            </FrameDescription>
          </FrameHeader>
          <FramePanel>
            <Alert variant="destructive">
              <AlertTitle>Mercado Pago no está configurado</AlertTitle>
              <AlertDescription>
                Define MERCADOPAGO_ACCESS_TOKEN en el servidor para consultar
                los depósitos acreditados.
              </AlertDescription>
            </Alert>
          </FramePanel>
        </Frame>
      </div>
    )
  }

  // El día inicial viaja servido por la RSC; el fallo inicial no rompe el
  // render: la vista lo muestra y el botón refrescar lo reintenta.
  let initialReport: SpeiDayReport | null = null
  let initialError: string | null = null
  try {
    initialReport = await listSpeiDepositsForDay(today)
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "No se pudo consultar Mercado Pago."
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Reporte SPEI</h1>
      <ReporteSpeiView
        initialReport={initialReport}
        initialError={initialError}
        today={today}
      />
    </div>
  )
}
