"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: UpdateProfileState = { error: null, success: null }

function formatClabe(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 18)
    .replace(/(\d{3})(?=\d)/g, "$1 ")
    .trim()
}

export function ProfileForm({
  fullName,
  whatsappPhone,
  bankName,
  bankHolder,
  bankClabe,
}: {
  fullName: string
  whatsappPhone: string
  bankName: string
  bankHolder: string
  bankClabe: string
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

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state.success, router])

  useEffect(() => {
    if (bankingState.success) {
      toast.success(bankingState.success)
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
            Cuenta donde recibes tus pagos por transferencia.
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
                18 dígitos; se agrupan automáticamente.
              </p>
            </div>
            {bankingState.error ? (
              <p className="text-destructive text-sm" role="alert">
                {bankingState.error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="pt-3">
            <Button type="submit" size="sm" disabled={isBankingPending}>
              {isBankingPending ? "Guardando…" : "Guardar datos bancarios"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
