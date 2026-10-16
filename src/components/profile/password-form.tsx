"use client"

import { useActionState, useEffect, useRef } from "react"
import { toast } from "sonner"

import {
  changePasswordAction,
  type ChangePasswordState,
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

const initialState: ChangePasswordState = { error: null, success: null }

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, isPending] = useActionState(
    changePasswordAction,
    initialState
  )

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      formRef.current?.reset()
    }
  }, [state.success])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Seguridad</CardTitle>
        <CardDescription className="text-sm">
          Cambia tu contraseña periódicamente.
        </CardDescription>
      </CardHeader>
      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col"
      >
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-current-password">Contraseña actual</Label>
            <Input
              id="profile-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-new-password">Nueva contraseña</Label>
            <Input
              id="profile-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="text-muted-foreground text-xs">Mínimo 8 caracteres.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-confirm-password">
              Confirmar nueva contraseña
            </Label>
            <Input
              id="profile-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="pt-3">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Actualizando…" : "Actualizar contraseña"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
