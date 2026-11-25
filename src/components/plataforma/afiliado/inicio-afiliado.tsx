"use client"

import { CopyIcon, Share2Icon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FrameTitle,
} from "@/components/reui/frame"

/**
 * «Inicio» del perfil AFILIADO (`platform.spei.link/inicio`): su enlace de
 * invitación (copiar, compartir, QR) y las cifras del embudo (clic →
 * registro → configurado). La lista de negocios referidos vive en la sección
 * Clientes (`/clientes`), segmentada por perfil. Antes era el portal
 * `/afiliado` (plan speilink-afiliados §6.8).
 */

export function InicioAfiliado({
  code,
  fullName,
  email,
  status,
  clickCount,
  signupCount,
  configuredCount,
  link,
  qrDataUrl,
}: {
  code: string
  fullName: string
  email: string
  status: "active" | "suspended"
  clickCount: number
  signupCount: number
  configuredCount: number
  link: string
  qrDataUrl: string
}) {
  const copyLink = () => {
    void navigator.clipboard
      ?.writeText(link)
      .then(() => toast("El enlace copiado"))
      .catch(() => toast.error("No se pudo copiar"))
  }

  /** Comparte el enlace con el medio del sistema (patrón LinkCreadoDialog). */
  const shareLink = () => {
    const text = `Abre tu cuenta de SPEILink desde mi enlace: ${link}`
    if (typeof navigator.share === "function") {
      void navigator
        .share({ title: "SPEILink", text, url: link })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          copyLink()
        })
      return
    }
    copyLink()
  }

  const stats = [
    { label: "Clics en tu enlace", value: clickCount },
    { label: "Negocios registrados", value: signupCount },
    { label: "Negocios configurados", value: configuredCount },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Frame>
        <FrameHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <FrameTitle>Hola, {fullName}</FrameTitle>
            <FrameDescription>{email} · tu enlace de invitación</FrameDescription>
          </div>
          {status === "active" ? (
            <Badge variant="primary-light" size="sm">Activo</Badge>
          ) : (
            <Badge variant="warning-light" size="sm">Suspendido</Badge>
          )}
        </FrameHeader>
        {status !== "active" ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800">
            Tu enlace está desactivado: los botones de registro ya no funcionan
            para quien lo abra. Tus cifras y la atribución de los negocios que
            ya llegaron se conservan. Contacta a soporte para reactivarlo.
          </p>
        ) : null}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR como data URL generado en el servidor */}
          <img
            src={qrDataUrl}
            alt={`QR del enlace de afiliado ${code}`}
            className="size-40 shrink-0 rounded-lg border bg-white p-2"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-muted-foreground text-sm font-medium">
              Tu enlace de invitación
            </p>
            <p className="min-w-0 flex-1 break-all rounded-lg bg-muted/50 px-3 py-2 font-mono text-sm select-all">
              {link}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                <CopyIcon data-icon="inline-start" />
                Copiar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={shareLink}>
                <Share2Icon data-icon="inline-start" />
                Compartir
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Quien cree su cuenta desde este enlace queda asociado a ti. Tu
              código de afiliado es{" "}
              <span className="text-foreground font-mono font-semibold">{code}</span>{" "}
              y no cambia.
            </p>
          </div>
        </div>
      </Frame>

      <Frame>
        <FrameHeader className="flex flex-col gap-1">
          <FrameTitle>Cifras</FrameTitle>
          <FrameDescription>
            Clics en tu enlace, negocios registrados y negocios ya configurados
            (cuenta de Mercado Pago, datos bancarios y WhatsApp conectados).
          </FrameDescription>
        </FrameHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col gap-1 rounded-xl border bg-muted/30 p-4"
            >
              <span className="text-2xl font-semibold tabular-nums">{stat.value}</span>
              <span className="text-muted-foreground text-sm">{stat.label}</span>
            </div>
          ))}
        </div>
      </Frame>
    </div>
  )
}
