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
import { requireUser } from "@/server/auth/guards"
import {
  cdmxToday,
  listSpeiDepositsForDay,
  speiReportConfigured,
  type SpeiDayReport,
} from "@/server/mercadopago/spei"
import { getOwnMpAccessToken } from "@/server/mercadopago/tokens"

export const metadata: Metadata = {
  title: "Reporte SPEILink",
}

/** Degrade sin romper el render: tarjeta con la causa y la salida. */
function Degradada({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Reporte SPEILink</h1>
      <Frame spacing="default" className="w-full">
        <FrameHeader>
          <FrameTitle className="text-xl font-semibold">Reporte SPEILink</FrameTitle>
          <FrameDescription>
            Depósitos por transferencia bancaria (SPEI a la CLABE) acreditados
            en Mercado Pago, por día.
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
          <Alert variant="destructive">
            <AlertTitle>{titulo}</AlertTitle>
            <AlertDescription>{texto}</AlertDescription>
          </Alert>
        </FramePanel>
      </Frame>
    </div>
  )
}

export default async function ReporteSpeiPage() {
  const user = await requireUser()
  const today = cdmxToday()

  // Fuente de los depósitos: la credencial PROPIA del distribuidor consulta
  // SU cuenta (columna «Concepto» acotada a SUS conceptos); el admin sigue
  // con la cuenta de plataforma del `.env`, el comportamiento histórico.
  if (user.role !== "admin") {
    const ownToken = await getOwnMpAccessToken(user.id).catch(() => null)
    if (!ownToken) {
      return (
        <Degradada
          titulo="Falta tu token de Mercado Pago"
          texto="Para ver los depósitos acreditados en TU cuenta, registra tu access token de producción en Perfil → Información → Datos bancarios (Token de Mercado Pago). Queda cifrado y no se vuelve a mostrar."
        />
      )
    }

    let initialReport: SpeiDayReport | null = null
    let initialError: string | null = null
    try {
      initialReport = await listSpeiDepositsForDay(today, ownToken, {
        conceptBuyerUserId: user.id,
      })
    } catch (error) {
      initialError =
        error instanceof Error
          ? error.message
          : "No se pudo consultar Mercado Pago."
    }

    return (
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <h1 className="sr-only">Reporte SPEILink</h1>
        <ReporteSpeiView
          initialReport={initialReport}
          initialError={initialError}
          today={today}
        />
      </div>
    )
  }

  if (!speiReportConfigured()) {
    return (
      <Degradada
        titulo="Mercado Pago no está configurado"
        texto="Define MERCADOPAGO_ACCESS_TOKEN en el servidor para consultar los depósitos acreditados."
      />
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
      <h1 className="sr-only">Reporte SPEILink</h1>
      <ReporteSpeiView
        initialReport={initialReport}
        initialError={initialError}
        today={today}
      />
    </div>
  )
}
