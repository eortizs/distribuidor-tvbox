"use client"

import { useState, useTransition } from "react"

import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  QrCodeIcon,
  Share2Icon,
} from "lucide-react"

import {
  getPaymentQrAction,
  type PaymentQrLink,
} from "@/app/actions/links-pago"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
import {
  copyPaymentLink,
  sharePaymentLink,
} from "@/components/herramientas/links-pago/share-payment-link"

/*
 * Tarjeta del QR FIJO de cobro (/modulos/links-de-pago): un QR permanente
 * por cobrador para cobros LIBRES — el pagador escanea, recibe los datos de
 * la cuenta por WhatsApp, transfiere el monto que quiera (concepto libre) y
 * envía su comprobante, que confirma el depósito en la cuenta. Dos estados:
 * sin código todavía (qué es y el botón que lo asigna) y el QR ya armado
 * (imagen para imprimir o descargar, link corto, compartir y la prueba en
 * su propio WhatsApp).
 */

/** Cómo cobra el cliente con el QR, en orden. */
const PASOS_DEL_PAGADOR = [
  "Escanea tu QR y envía el mensaje de WhatsApp que ya viene escrito.",
  "Recibe tus datos bancarios y transfiere por SPEI el monto que quiera (el concepto es libre).",
  "Envía su comprobante por WhatsApp y el sistema confirma el depósito en tu cuenta.",
]

interface QrFijoCardProps {
  /** QR ya asignado del servidor; null = el cobrador aún no tiene código. */
  initialQr: PaymentQrLink | null
  whatsappConfigured: boolean
}

export function QrFijoCard({ initialQr, whatsappConfigured }: QrFijoCardProps) {
  const [qr, setQr] = useState(initialQr)
  const [serverQr, setServerQr] = useState(initialQr)
  const [error, setError] = useState<string | null>(null)
  const [generating, startGenerating] = useTransition()

  // El RSC re-renderiza la página en cualquier momento (bus de tiempo real,
  // acciones): al llegar un snapshot nuevo del servidor se adopta (misma
  // mecánica del listado). Ajuste DURANTE el render, sin efectos.
  if (serverQr !== initialQr) {
    setServerQr(initialQr)
    setQr(initialQr)
  }

  function downloadQr() {
    if (!qr) return
    const link = document.createElement("a")
    link.href = qr.qrDataUrl
    link.download = `qr-fijo-${qr.code}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  /**
   * Comparte el LINK corto (spei.link/cobro/<código>) —que abre el chat de
   * WhatsApp con el mensaje listo— con la misma mecánica que el diálogo de
   * los links de pago (share-payment-link.ts): título + texto + URL por la
   * Web Share API, nunca la imagen; sin hoja de compartir, copia el link.
   */
  function shareQr() {
    if (!qr) return
    void sharePaymentLink({
      text: `Link de pago ${qr.code}`,
      url: qr.shortUrl,
    })
  }

  function generate() {
    setError(null)
    startGenerating(async () => {
      const result = await getPaymentQrAction()
      if (result.error || !result.qr) {
        setError(result.error ?? "No se pudo generar tu QR fijo.")
        return
      }
      setQr(result.qr)
    })
  }

  return (
    <FramePanel>
      <FrameHeader>
        <FrameTitle className="text-lg font-semibold">QR fijo de cobro</FrameTitle>
        <FrameDescription>
          Un solo QR para siempre: tu cliente escanea, recibe tus datos
          bancarios por WhatsApp y transfiere el monto que quiera; su
          comprobante confirma el depósito en tu cuenta.
        </FrameDescription>
      </FrameHeader>
      {qr ? (
        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          <div className="flex shrink-0 flex-col items-center gap-2 md:w-72">
            {/* eslint-disable-next-line @next/next/no-img-element -- el QR es un data URL generado en el servidor; el optimizador de next/image no aplica */}
            <img
              src={qr.qrDataUrl}
              alt={`QR fijo de cobro ${qr.code}`}
              width={480}
              height={480}
              className="size-60 rounded-lg border bg-white p-2 md:size-72"
            />
            <p className="text-center font-mono text-muted-foreground text-sm break-all">
              {qr.code}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-sm">Cómo paga tu cliente</p>
              <ol className="flex flex-col gap-1.5 text-muted-foreground text-sm">
                {PASOS_DEL_PAGADOR.map((paso, index) => (
                  <li key={paso} className="flex items-start gap-2">
                    <span className="font-medium text-foreground tabular-nums">
                      {index + 1}.
                    </span>
                    <span>{paso}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex w-full items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-sm">
                {qr.shortUrl}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative after:content-[''] after:absolute after:-inset-2"
                aria-label="Copiar el link de tu QR"
                onClick={() => copyPaymentLink(qr.shortUrl)}
              >
                <CopyIcon aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button type="button" size="lg" className="flex-1" onClick={downloadQr}>
                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  Descargar QR
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    shareQr()
                  }}
                >
                  <Share2Icon data-icon="inline-start" aria-hidden="true" />
                  Compartir
                </Button>
              </div>
              <Button
                variant="outline"
                size="lg"
                nativeButton={false}
                render={
                  <a
                    href={qr.waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Probar tu QR abriendo el chat de WhatsApp"
                  />
                }
              >
                <ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />
                Probar en mi WhatsApp
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <QrCodeIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Aún no tienes tu QR fijo</EmptyTitle>
              <EmptyDescription>
                Imprímelo y muéstralo en tu negocio: tu cliente escanea, recibe
                tus datos bancarios por WhatsApp, transfiere el monto que quiera
                y envía su comprobante.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                size="lg"
                disabled={generating || !whatsappConfigured}
                onClick={generate}
              >
                <QrCodeIcon data-icon="inline-start" aria-hidden="true" />
                {generating ? "Generando…" : "Generar mi QR fijo"}
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )}
    </FramePanel>
  )
}
