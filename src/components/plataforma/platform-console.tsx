"use client"

import { useState } from "react"
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
  createTenantAction,
  resetTenantOwnerPasswordAction,
  setTenantStatusAction,
} from "@/app/actions/platform"

export interface PlatformTenantItem {
  id: string
  slug: string
  name: string
  kind: "legacy" | "business"
  status: "active" | "suspended"
  whatsappNumber: string | null
  ownerEmail: string | null
  userCount: number
  createdAtLabel: string
}

/**
 * Consola de plataforma (§2.4): lista de tenants, alta con propietario
 * (contraseña temporal mostrada UNA vez), suspender/reactivar y
 * restablecimiento de contraseña del propietario.
 */
export function PlatformConsole({ tenants }: { tenants: PlatformTenantItem[] }) {
  const [altaOpen, setAltaOpen] = useState(false)
  const [created, setCreated] = useState<{
    slug: string
    ownerEmail: string
    password: string
  } | null>(null)
  const [resetTarget, setResetTarget] = useState<PlatformTenantItem | null>(null)
  const [resetPassword, setResetPassword] = useState<string | null>(null)
  const [statusTarget, setStatusTarget] = useState<PlatformTenantItem | null>(null)
  const [altaError, setAltaError] = useState<string | null>(null)
  const [handleCreatePending, setHandleCreatePending] = useState(false)

  const openAlta = () => {
    setAltaError(null)
    setAltaOpen(true)
  }

  const handleCreate = async (formData: FormData) => {
    setAltaError(null)
    setHandleCreatePending(true)
    try {
    const state = await createTenantAction(
      { error: null, created: null, temporaryPassword: null },
      formData
    )
    if (state.error || !state.created || !state.temporaryPassword) {
      setAltaError(state.error ?? "No fue posible crear el tenant.")
      return
    }
    setCreated({
      slug: state.created.slug,
      ownerEmail: state.created.ownerEmail,
      password: state.temporaryPassword,
    })
    setAltaOpen(false)
    toast("Tenant creado")
    } finally {
      setHandleCreatePending(false)
    }
  }

  const handleStatus = async (target: PlatformTenantItem) => {
    const next = target.status === "active" ? "suspended" : "active"
    const result = await setTenantStatusAction(target.id, next)
    if (!result.ok) {
      toast(result.error ?? "No fue posible cambiar el estado.")
      return
    }
    toast(next === "suspended" ? "Tenant suspendido" : "Tenant reactivado")
    setStatusTarget(null)
  }

  const handleReset = async (target: PlatformTenantItem) => {
    const result = await resetTenantOwnerPasswordAction(target.id)
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
          <FrameTitle>Tenants</FrameTitle>
          <FrameDescription>
            Negocios activos en {`spei.link`}. El legado `tvbox` no se gestiona aquí.
          </FrameDescription>
        </div>
        <Button type="button" onClick={openAlta} disabled={handleCreatePending}>
          Nuevo tenant
        </Button>
      </FrameHeader>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Propietario</th>
              <th className="px-3 py-2 font-medium">Cuentas</th>
              <th className="px-3 py-2 font-medium">WhatsApp</th>
              <th className="px-3 py-2 font-medium">Creado</th>
              <th className="px-3 py-2 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{tenant.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {tenant.slug}.spei.link
                  </div>
                </td>
                <td className="px-3 py-2">
                  {tenant.kind === "legacy" ? (
                    <Badge variant="secondary" size="sm">Legado</Badge>
                  ) : tenant.status === "active" ? (
                    <Badge variant="primary-light" size="sm">Activo</Badge>
                  ) : (
                    <Badge variant="warning-light" size="sm">Suspendido</Badge>
                  )}
                </td>
                <td className="px-3 py-2">{tenant.ownerEmail ?? "—"}</td>
                <td className="px-3 py-2">{tenant.userCount}</td>
                <td className="px-3 py-2">
                  {tenant.whatsappNumber ? (
                    <span className="inline-flex items-center gap-1">
                      +{tenant.whatsappNumber}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">no vinculado</span>
                  )}
                </td>
                <td className="px-3 py-2">{tenant.createdAtLabel}</td>
                <td className="px-3 py-2">
                  {tenant.kind === "business" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={handleCreatePending}
                        onClick={() => setResetTarget(tenant)}
                      >
                        Restablecer clave
                      </Button>
                      <Button
                        type="button"
                        variant={tenant.status === "active" ? "destructive" : "outline"}
                        size="sm"
                        disabled={handleCreatePending}
                        onClick={() => setStatusTarget(tenant)}
                      >
                        {tenant.status === "active" ? "Suspender" : "Reactivar"}
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Alta de tenant */}
      <Dialog open={altaOpen} onOpenChange={setAltaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo tenant</DialogTitle>
            <DialogDescription>
              Crea el negocio y su propietario. La contraseña temporal se muestra una sola vez.
            </DialogDescription>
          </DialogHeader>
          <form
            action={(formData) => {
              void handleCreate(formData)
            }}
            className="flex flex-col gap-3"
          >
            <Field>
              <FieldLabel htmlFor="tenant-name">Nombre del negocio</FieldLabel>
              <Input id="tenant-name" name="name" required maxLength={80} placeholder="Don Polo" />
            </Field>
            <Field>
              <FieldLabel htmlFor="tenant-slug">Subdominio (slug)</FieldLabel>
              <Input
                id="tenant-slug"
                name="slug"
                required
                pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                minLength={3}
                maxLength={30}
                placeholder="donpolo"
              />
              <p className="text-muted-foreground text-xs">
                El panel quedará en {`<slug>`}.spei.link
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="tenant-owner">Correo del propietario</FieldLabel>
              <Input
                id="tenant-owner"
                name="ownerEmail"
                type="email"
                required
                placeholder="dueno@donpolo.mx"
              />
            </Field>
            {altaError ? (
              <p className="text-destructive text-sm">{altaError}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAltaOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={handleCreatePending}>
                {handleCreatePending ? "Creando…" : "Crear tenant"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Contraseña temporal (alta o reset): mostrada UNA vez */}
      <Dialog
        open={created !== null || resetPassword !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreated(null)
            setResetPassword(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contraseña temporal</DialogTitle>
            <DialogDescription>
              {created
                ? `Entrega al propietario de ${created.slug}.spei.link (${created.ownerEmail}) por un canal aparte. Se muestra UNA sola vez.`
                : "Entrega la contraseña temporal al propietario por un canal aparte. Se muestra UNA sola vez."}
            </DialogDescription>
          </DialogHeader>
          <p className="bg-muted rounded-lg px-3 py-2 font-mono text-base break-all select-all">
            {created?.password ?? resetPassword}
          </p>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                const value = created?.password ?? resetPassword
                if (value) {
                  void navigator.clipboard?.writeText(value)
                  toast("Contraseña copiada")
                }
              }}
            >
              Copiar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreated(null)
                setResetPassword(null)
              }}
            >
              Cerrado, la anoté
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
                ? `¿Suspender ${statusTarget?.name}?`
                : `¿Reactivar ${statusTarget?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Suspendido, nadie inicia sesión en {statusTarget?.slug}.spei.link y sus sesiones
              activas quedan rechazadas al instante. Los links de pago siguen resolviendo.
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
              ¿Restablecer la contraseña de {resetTarget?.ownerEmail ?? "el propietario"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se genera una contraseña temporal para el propietario de {resetTarget?.slug}.spei.link;
              la actual deja de funcionar de inmediato.
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
    </Frame>
  )
}
