"use client"

import { toast } from "sonner"

/*
 * Compartir y copiar el LINK de pago: la misma mecánica para los dos
 * formatos de cobro de /modulos/links-de-pago —el diálogo del link con
 * importe y la tarjeta del QR fijo—, que por regla del dueño deben
 * comportarse idéntico: lo que viaja al pagador es un LINK que abre
 * WhatsApp, nunca la imagen del QR.
 */

/** Copia el link al portapapeles y avisa con el toast de siempre. */
export function copyPaymentLink(url: string): void {
  void navigator.clipboard
    .writeText(url)
    .then(() => toast.success("El link de pago copiado"))
    .catch(() => toast.error("No se pudo copiar"))
}

/**
 * Comparte el link corto con el medio que elija el cobrador (WhatsApp,
 * SMS, etc.) vía la Web Share API del sistema. Sin soporte (desktop sin
 * hoja de compartir) o ante un fallo real, cae a copiar al portapapeles;
 * cancelar la hoja nativa (AbortError) no es error ni copia nada.
 */
export async function sharePaymentLink(input: {
  text: string
  url: string
}): Promise<void> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Link de pago",
        text: input.text,
        url: input.url,
      })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
    }
  }
  copyPaymentLink(input.url)
}
