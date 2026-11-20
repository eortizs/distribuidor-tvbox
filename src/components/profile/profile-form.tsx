"use client"

import { useActionState, useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  clearMpToken,
  updateBankingAction,
  updateProfileAction,
  type UpdateProfileState,
} from "@/app/actions/profile"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/reui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: UpdateProfileState = { error: null, success: null }

export interface MpTokenStatus {
  nickname: string | null
  last4: string
  status: "active" | "invalid"
  validatedAt: string | null
}

function formatClabe(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 18)
    .replace(/(\d{3})(?=\d)/g, "$1 ")
    .trim()
}

/** Fecha CDMX determinista (misma técnica de notas): sin hydration drift. */
const tokenDateFormat = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  dateStyle: "medium",
  timeStyle: "short",
})

export function ProfileForm({
  fullName,
  whatsappPhone,
  bankName,
  bankHolder,
  bankClabe,
  mpToken,
}: {
  fullName: string
  whatsappPhone: string
  bankName: string
  bankHolder: string
  bankClabe: string
  mpToken: MpTokenStatus | null
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    updateProfileAction,
    initialState
  )
  const [bankingState, bankingFormAction, isBankingPending] = useActionState(
    updateBankingAction,
    initialState
  )
  // WRITE-ONLY: el token nunca se pre-llena; tras guardar se limpia el campo
  // para que no quede la credencial escrita en el formulario.
  const mpTokenRef = useRef<HTMLInputElement>(null)
  // «Quitar token»: acción de servidor llamada en transacción (el botón vive
  // dentro del formulario de datos bancarios y un <form> anidado es HTML
  // inválido).
  const [isClearPending, startClearTransition] = useTransition()

  function handleQuitarToken(): void {
    startClearTransition(async () => {
      const result = await clearMpToken()
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(result.success)
      router.refresh()
    })
  }

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state.success, router])

  useEffect(() => {
    if (bankingState.success) {
      toast.success(bankingState.success)
      if (mpTokenRef.current) mpTokenRef.current.value = ""
      router.refresh()
    }
  }, [bankingState.success, router])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Información personal</CardTitle>
          <CardDescription className="text-sm">
            Los cambios quedan registrados en el historial de la entidad Cuenta.
          </CardDescription>
        </CardHeader>
        <form action={formAction} className="flex flex-col">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-full-name">Nombre completo</Label>
              <Input
                id="profile-full-name"
                name="fullName"
                type="text"
                defaultValue={fullName}
                maxLength={100}
                autoComplete="name"
                placeholder="Ana Pérez García"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-whatsapp">WhatsApp</Label>
              <Input
                id="profile-whatsapp"
                name="whatsappPhone"
                type="tel"
                inputMode="numeric"
                defaultValue={whatsappPhone}
                maxLength={20}
                placeholder="525540049353"
                aria-describedby="profile-whatsapp-hint"
              />
              <p id="profile-whatsapp-hint" className="text-muted-foreground text-xs">
                Tu número con código de país, solo dígitos (11 a 15; p. ej.
                525540049353). Regístralo para recibir las notificaciones del
                panel y consultar tu cuenta con el agente de WhatsApp.
              </p>
            </div>
            {state.error ? (
              <p className="text-destructive text-sm" role="alert">
                {state.error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="pt-3">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Datos bancarios</CardTitle>
          <CardDescription className="text-sm">
            Cuenta donde recibes tus pagos por transferencia, y tu token de
            Mercado Pago para verificar depósitos automáticamente.
          </CardDescription>
        </CardHeader>
        <form action={bankingFormAction} className="flex flex-col">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-bank-name">Banco</Label>
              <Input
                id="profile-bank-name"
                name="bankName"
                type="text"
                defaultValue={bankName}
                maxLength={60}
                placeholder="BBVA"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-bank-holder">Destinatario</Label>
              <Input
                id="profile-bank-holder"
                name="bankHolder"
                type="text"
                defaultValue={bankHolder}
                maxLength={100}
                autoComplete="name"
                placeholder="Ana Pérez García"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-bank-clabe">CLABE</Label>
              <Input
                id="profile-bank-clabe"
                name="bankClabe"
                type="text"
                inputMode="numeric"
                defaultValue={formatClabe(bankClabe)}
                placeholder="002 180 123 456 789 012"
                aria-describedby="profile-bank-clabe-hint"
                onChange={(e) => {
                  e.currentTarget.value = formatClabe(e.currentTarget.value)
                }}
              />
              <p
                id="profile-bank-clabe-hint"
                className="text-muted-foreground text-xs"
              >
                18 dígitos; se agrupan automáticamente. Si es la CLABE de tu
                cuenta de Mercado Pago, tus clientes pueden depositarte
                directamente en ella.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="profile-mp-token">Token de Mercado Pago</Label>
                {mpToken ? (
                  <span className="flex items-center gap-2">
                    <Badge
                      variant={mpToken.status === "active" ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {mpToken.status === "active" ? "Vinculado" : "Inválido"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {mpToken.nickname ? `${mpToken.nickname} · ` : ""}
                      ••••{mpToken.last4}
                    </span>
                  </span>
                ) : null}
              </div>
              <Input
                id="profile-mp-token"
                ref={mpTokenRef}
                name="mpToken"
                type="password"
                defaultValue=""
                maxLength={512}
                autoComplete="off"
                placeholder={mpToken ? "Reemplazar token…" : "APP_USR-…"}
                aria-describedby="profile-mp-token-hint"
              />
              <p
                id="profile-mp-token-hint"
                className="text-muted-foreground text-xs"
              >
                Opcional. Access token de <strong>producción</strong> de TU
                cuenta de Mercado Pago (Mercado Pago → Tus integraciones →
                Credenciales de producción). Queda cifrado en el servidor y no
                se vuelve a mostrar. Con tu token, tus clientes pueden
                depositarte directamente a tu cuenta y el sistema verifica sus
                pagos automáticamente (links de pago, renovaciones y Reporte
                SPEI de tu cuenta).
                {mpToken?.status === "invalid"
                  ? " El token registrado fue rechazado por Mercado Pago: regístralo nuevamente."
                  : ""}
                {mpToken?.validatedAt
                  ? ` Validado el ${tokenDateFormat.format(new Date(mpToken.validatedAt))}.`
                  : ""}
              </p>
            </div>
            {bankingState.error ? (
              <p className="text-destructive text-sm" role="alert">
                {bankingState.error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-2 pt-3">
            {mpToken ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={handleQuitarToken}
                disabled={isClearPending}
              >
                {isClearPending ? "Quitando…" : "Quitar token"}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={isBankingPending}>
              {isBankingPending ? "Guardando…" : "Guardar datos bancarios"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
