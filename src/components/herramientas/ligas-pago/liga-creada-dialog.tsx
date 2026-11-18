"use client"

import { CopyIcon, ExternalLinkIcon, PrinterIcon, Share2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { paymentOrderMoney } from "@/lib/ligas-pago"
import type { CreatedPaymentOrder } from "@/app/actions/ligas-pago"

/*
 * Diálogo de liga de pago creada: QR + datos SPEI + copiar liga/código.
 * El QR y la liga compartida son la CORTA (spei.link/<código>, misma
 * identidad que el código de concepto); el botón de apertura usa wa.me
 * directo (un salto menos). Compartido por /modulos/ligas-de-pago y el
 * cobro desde la Calculadora.
 */

interface LigaCreadaDialogProps {
  order: CreatedPaymentOrder | null
  onClose: () => void
}

export function LigaCreadaDialog({ order, onClose }: LigaCreadaDialogProps) {
  function copyText(value: string, label: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`${label} copiada`))
      .catch(() => toast.error("No se pudo copiar"))
  }

  /**
   * Comparte la liga corta con el medio que elija el cobrador (WhatsApp,
   * SMS, etc.) vía Web Share API del sistema. Sin soporte (desktop sin
   * share sheet) o ante un fallo real, cae a copiar al portapapeles;
   * cancelar el sheet nativo (AbortError) no es error ni copia nada.
   */
  async function shareLiga(order: CreatedPaymentOrder) {
    const text = `Liga de pago ${order.code} por ${paymentOrderMoney(order.amountMxn)}`
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Liga de pago", text, url: order.shortUrl })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }
    copyText(order.shortUrl, "La liga de pago")
  }

  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        {order ? (
          <>
            <DialogHeader>
              <DialogTitle>Liga de pago {order.code}</DialogTitle>
              <DialogDescription>
                Muestra el QR al pagador para que abra el chat con el mensaje
                listo, o comparte la liga corta.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- el QR es un data URL generado en el servidor; el optimizador de next/image no aplica */}
              <img
                src={order.qrDataUrl}
                alt={`QR de la liga de pago ${order.code}`}
                className="size-52 rounded-lg border bg-white p-2"
              />
              <p className="text-2xl font-semibold tabular-nums">
                {paymentOrderMoney(order.amountMxn)}
              </p>
              <p className="break-all text-center font-mono text-muted-foreground text-sm">
                {order.shortUrl}
              </p>
              <div className="w-full rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">Datos para la transferencia SPEI</p>
                <p>Banco: {order.bank.bank}</p>
                <p>Cuenta: {order.bank.account}</p>
                <p>Titular: {order.bank.holder}</p>
                <p>
                  Concepto de pago:{" "}
                  <span className="font-mono font-semibold">
                    {order.code}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    void shareLiga(order)
                  }}
                >
                  <Share2Icon data-icon="inline-start" />
                  Compartir
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative after:content-[''] after:absolute after:-inset-2"
                  render={
                    <a
                      href={order.waUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Abrir la liga de pago en WhatsApp"
                    />
                  }
                >
                  <ExternalLinkIcon />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1"
                  onClick={() => copyText(order.code, "El código de pago")}
                >
                  <CopyIcon data-icon="inline-start" />
                  Copiar código
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative after:content-[''] after:absolute after:-inset-2"
                  aria-label="Imprimir el QR de la liga"
                  onClick={() => window.print()}
                >
                  <PrinterIcon />
                </Button>
              </div>
              <Button size="lg" onClick={onClose}>
                Listo
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
