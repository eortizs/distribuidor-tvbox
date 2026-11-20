"use client"

import { CopyIcon, ExternalLinkIcon, Share2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { paymentOrderMoney } from "@/lib/links-pago"
import type { CreatedPaymentOrder } from "@/app/actions/links-pago"

/*
 * Diálogo de link de pago creado: QR + datos SPEI + copiar/compartir link.
 * El QR y el link compartido son el CORTO (spei.link/<código>, misma
 * identidad que el código); el botón de apertura usa wa.me directo (un
 * salto menos). El CONCEPTO DE PAGO NO se imprime aquí: queda oculto hasta
 * que el pagador solicite el pago por WhatsApp (el agente se lo entrega
 * junto con la CLABE). Compartido por /modulos/links-de-pago y el cobro
 * desde la Calculadora.
 */

interface LinkCreadoDialogProps {
  order: CreatedPaymentOrder | null
  onClose: () => void
}

export function LinkCreadoDialog({ order, onClose }: LinkCreadoDialogProps) {
  function copyText(value: string, label: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`${label} copiado`))
      .catch(() => toast.error("No se pudo copiar"))
  }

  /**
   * Comparte el link corto con el medio que elija el cobrador (WhatsApp,
   * SMS, etc.) vía Web Share API del sistema. Sin soporte (desktop sin
   * share sheet) o ante un fallo real, cae a copiar al portapapeles;
   * cancelar el sheet nativo (AbortError) no es error ni copia nada.
   */
  async function shareLink(order: CreatedPaymentOrder) {
    const text = `Link de pago ${order.code} por ${paymentOrderMoney(order.amountMxn)}`
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Link de pago", text, url: order.shortUrl })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }
    copyText(order.shortUrl, "El link de pago")
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
              <DialogTitle>Link de pago {order.code}</DialogTitle>
              <DialogDescription>
                Muestra el QR a tu cliente para que abra el chat con el mensaje
                listo: ahí recibe el concepto de pago para pagar por SPEI.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- el QR es un data URL generado en el servidor; el optimizador de next/image no aplica */}
              <img
                src={order.qrDataUrl}
                alt={`QR del link de pago ${order.code}`}
                className="size-52 rounded-lg border bg-white p-2"
              />
              <p className="text-2xl font-semibold tabular-nums">
                {paymentOrderMoney(order.amountMxn)}
              </p>
              <div className="flex w-full items-center gap-2">
                <p className="min-w-0 flex-1 break-all text-center font-mono text-muted-foreground text-sm">
                  {order.shortUrl}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative after:content-[''] after:absolute after:-inset-2"
                  aria-label="Copiar el link de pago"
                  onClick={() => copyText(order.shortUrl, "El link de pago")}
                >
                  <CopyIcon />
                </Button>
              </div>
              <div className="w-full rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">Datos para la transferencia SPEI</p>
                <p>Banco: {order.bank.bank}</p>
                <p>Cuenta: {order.bank.account}</p>
                <p>Titular: {order.bank.holder}</p>
                <p className="text-muted-foreground">
                  El concepto de pago se lo entrega el agente por WhatsApp
                  cuando solicite el pago.
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
                    void shareLink(order)
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
                      aria-label="Abrir el link de pago en WhatsApp"
                    />
                  }
                >
                  <ExternalLinkIcon />
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
