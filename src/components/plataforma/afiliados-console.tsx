"use client"

import { useState } from "react"
import { CopyIcon, Share2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/reui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Frame, FrameHeader, FrameTitle, FrameDescription } from "@/components/reui/frame"
import {
  createAffiliateAction,
  resetAffiliatePasswordAction,
  setAffiliateStatusAction,
} from "@/app/actions/platform"

export interface AffiliateItem {
  id: string
  code: string
  fullName: string
  email: string
  status: "active" | "suspended"
  clickCount: number
  signupCount: number
  /** Enlace público completo (https://spei.link/afiliado/CÓDIGO). */
  link: string
  createdAtLabel: string
}

/**
 * Módulo «Afiliados» de la consola de plataforma (§6.7 del plan de
 * afiliados): enlace propio spei.link/afiliado/CÓDIGO, clics, registros,
 * alta con contraseña temporal mostrada UNA vez, suspender/reactivar el
 * enlace y restablecer la contraseña. Vive en `/platform/afiliados` desde
 * que la consola se volvió hub de módulos. Suspendido = el enlace deja de
 * funcionar y la atribución se conserva.
 */
export function AffiliatesConsole({
  affiliates,
}: {
  affiliates: AffiliateItem[]
}) {
  const [altaOpen, setAltaOpen] = useState(false)
  const [altaError, setAltaError] = useState<string | null>(null)
  const [handleCreatePending, setHandleCreatePending] = useState(false)
  const [created, setCreated] = useState<{
    code: string
    email: string
    password: string
  } | null>(null)
  const [statusTarget, setStatusTarget] = useState<AffiliateItem | null>(null)
  const [resetTarget, setResetTarget] = useState<AffiliateItem | null>(null)
  const [resetPassword, setResetPassword] = useState<string | null>(null)

  const pending = handleCreatePending

  const openAlta = () => {
    setAltaError(null)
    setAltaOpen(true)
  }

  const handleCreate = async (formData: FormData) => {
    setAltaError(null)
    setHandleCreatePending(true)
    try {
      const state = await createAffiliateAction(
        { error: null, created: null },
        formData
      )
      if (state.error || !state.created) {
        setAltaError(state.error ?? "No fue posible crear el afiliado.")
        return
      }
      setCreated({
        code: state.created.code,
        email: state.created.email,
        password: state.created.temporaryPassword,
      })
      setAltaOpen(false)
      toast("Afiliado creado")
    } finally {
      setHandleCreatePending(false)
    }
  }

  const copyText = (value: string, label: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast(`${label} copiado`))
      .catch(() => toast("No se pudo copiar"))
  }

  const shareAffiliateLink = (affiliate: AffiliateItem) => {
    const text = `Abre tu cuenta de SPEILink desde mi enlace: ${affiliate.link}`
    if (typeof navigator.share === "function") {
      void navigator
        .share({ title: "SPEILink", text, url: affiliate.link })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          copyText(affiliate.link, "El enlace del afiliado")
        })
      return
    }
    copyText(affiliate.link, "El enlace del afiliado")
  }

  const handleStatus = async (target: AffiliateItem) => {
    const next = target.status === "active" ? "suspended" : "active"
    const result = await setAffiliateStatusAction(target.id, next)
    if (!result.ok) {
      toast(result.error ?? "No fue posible cambiar el estado.")
      return
    }
    toast(next === "suspended" ? "Enlace del afiliado suspendido" : "Afiliado reactivado")
    setStatusTarget(null)
  }

  const handleReset = async (target: AffiliateItem) => {
    const result = await resetAffiliatePasswordAction(target.id)
    if (!result.ok || !result.password) {
      toast(result.error ?? "No fue posible restablecer la contraseña.")
      return
    }
    setResetPassword(result.password)
    setResetTarget(null)
  }

  return (
    <Frame className="flex flex-1 flex-col gap-4">
      <FrameHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <FrameTitle>Afiliados</FrameTitle>
          <FrameDescription>
            Cada afiliado tiene un enlace propio: quien crea su cuenta desde ahí
            queda atribuido a él. Atribución y estadísticas; el dinero no pasa
            por los afiliados.
          </FrameDescription>
        </div>
        <Button type="button" onClick={openAlta} disabled={pending}>
          Nuevo afiliado
        </Button>
      </FrameHeader>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">Afiliado</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Enlace</th>
              <th className="px-3 py-2 font-medium">Clics</th>
              <th className="px-3 py-2 font-medium">Registros</th>
              <th className="px-3 py-2 font-medium">Creado</th>
              <th className="px-3 py-2 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {affiliates.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted-foreground px-3 py-6 text-center">
                  Aún no hay afiliados.
                </td>
              </tr>
            ) : (
              affiliates.map((affiliate) => (
                <tr key={affiliate.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{affiliate.fullName}</div>
                    <div className="text-muted-foreground text-xs">{affiliate.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    {affiliate.status === "active" ? (
                      <Badge variant="primary-light" size="sm">Activo</Badge>
                    ) : (
                      <Badge variant="warning-light" size="sm">Suspendido</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">/afiliado/{affiliate.code}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{affiliate.clickCount}</td>
                  <td className="px-3 py-2 tabular-nums">{affiliate.signupCount}</td>
                  <td className="px-3 py-2">{affiliate.createdAtLabel}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="relative after:content-[''] after:absolute after:-inset-2"
                        aria-label="Copiar el enlace del afiliado"
                        disabled={pending}
                        onClick={() => copyText(affiliate.link, "El enlace del afiliado")}
                      >
                        <CopyIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="relative after:content-[''] after:absolute after:-inset-2"
                        aria-label="Compartir el enlace del afiliado"
                        disabled={pending}
                        onClick={() => shareAffiliateLink(affiliate)}
                      >
                        <Share2Icon />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => setResetTarget(affiliate)}
                      >
                        Restablecer clave
                      </Button>
                      <Button
                        type="button"
                        variant={affiliate.status === "active" ? "destructive" : "outline"}
                        size="sm"
                        disabled={pending}
                        onClick={() => setStatusTarget(affiliate)}
                      >
                        {affiliate.status === "active" ? "Suspender" : "Reactivar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Alta de afiliado */}
      <Dialog open={altaOpen} onOpenChange={setAltaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo afiliado</DialogTitle>
            <DialogDescription>
              Crea la cuenta del afiliado y su enlace. El código es opcional: sin
              él se genera uno. La contraseña temporal se muestra una sola vez.
            </DialogDescription>
          </DialogHeader>
          <form
            action={(formData) => {
              void handleCreate(formData)
            }}
            className="flex flex-col gap-3"
          >
            <Field>
              <FieldLabel htmlFor="affiliate-name">Nombre completo</FieldLabel>
              <Input
                id="affiliate-name"
                name="fullName"
                required
                maxLength={100}
                placeholder="María López"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="affiliate-email">Correo electrónico</FieldLabel>
              <Input
                id="affiliate-email"
                name="email"
                type="email"
                required
                placeholder="maria@ejemplo.mx"
              />
              <p className="text-muted-foreground text-xs">
                Un correo ya usado en cualquier panel no puede ser afiliado
                (usuarios únicos globales).
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="affiliate-code">Código (opcional)</FieldLabel>
              <Input
                id="affiliate-code"
                name="code"
                maxLength={4}
                placeholder="AB7D"
                autoComplete="off"
                spellCheck={false}
                className="font-mono uppercase"
              />
              <p className="text-muted-foreground text-xs">
                4 caracteres, sin 0, 1, I ni O. Inmutable: los enlaces impresos
                no mueren.
              </p>
            </Field>
            {altaError ? (
              <p className="text-destructive text-sm">{altaError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAltaOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creando…" : "Crear afiliado"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Enlace + contraseña temporal del afiliado: mostrados UNA vez */}
      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (!open) setCreated(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Afiliado creado</DialogTitle>
            <DialogDescription>
              Entrega el enlace y la contraseña temporal a {created?.email}{" "}
              por un canal aparte. La contraseña se muestra UNA sola vez.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <p className="bg-muted min-w-0 flex-1 rounded-lg px-3 py-2 font-mono text-sm break-all select-all">
                {created ? `https://spei.link/afiliado/${created.code}` : ""}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative after:content-[''] after:absolute after:-inset-2"
                aria-label="Copiar el enlace del afiliado"
                onClick={() =>
                  created &&
                  copyText(
                    `https://spei.link/afiliado/${created.code}`,
                    "El enlace del afiliado"
                  )
                }
              >
                <CopyIcon />
              </Button>
            </div>
            <p className="bg-muted rounded-lg px-3 py-2 font-mono text-base break-all select-all">
              {created?.password}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => created && copyText(created.password, "La contraseña")}
            >
              Copiar contraseña
            </Button>
            <Button type="button" variant="outline" onClick={() => setCreated(null)}>
              Cerrado, lo anoté
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de suspensión/reactivación */}
      <AlertDialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open) setStatusTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.status === "active"
                ? `¿Suspender el enlace de ${statusTarget?.fullName}?`
                : `¿Reactivar a ${statusTarget?.fullName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Suspendido, su enlace deja de funcionar al instante y el registro
              deja de aceptarlo; la atribución de los negocios que ya llegaron
              se conserva. Puede seguir entrando a su portal para ver sus cifras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (statusTarget) void handleStatus(statusTarget)
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación de restablecimiento */}
      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Restablecer la contraseña de {resetTarget?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se genera una contraseña temporal para el afiliado
              /afiliado/{resetTarget?.code}; la actual deja de funcionar de inmediato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resetTarget) void handleReset(resetTarget)
              }}
            >
              Restablecer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Contraseña temporal del restablecimiento: UNA vez */}
      <Dialog
        open={resetPassword !== null}
        onOpenChange={(open) => {
          if (!open) setResetPassword(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contraseña temporal</DialogTitle>
            <DialogDescription>
              Entrega la contraseña temporal al afiliado por un canal aparte. Se
              muestra UNA sola vez.
            </DialogDescription>
          </DialogHeader>
          <p className="bg-muted rounded-lg px-3 py-2 font-mono text-base break-all select-all">
            {resetPassword}
          </p>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                if (resetPassword) {
                  copyText(resetPassword, "La contraseña")
                }
              }}
            >
              Copiar
            </Button>
            <Button type="button" variant="outline" onClick={() => setResetPassword(null)}>
              Cerrado, la anoté
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Frame>
  )
}
