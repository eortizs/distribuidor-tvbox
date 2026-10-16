"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  updateProfileAction,
  type UpdateProfileState,
} from "@/app/actions/profile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initialState: UpdateProfileState = { error: null, success: null }

export function ProfileForm({
  email,
  fullName,
  phone,
}: {
  email: string
  fullName: string
  phone: string
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    updateProfileAction,
    initialState
  )

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state.success, router])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          type="email"
          value={email}
          readOnly
          disabled
          aria-describedby="profile-email-hint"
        />
        <p id="profile-email-hint" className="text-muted-foreground text-xs">
          Se usa para iniciar sesión y no se puede cambiar.
        </p>
      </div>
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
        <Label htmlFor="profile-phone">Teléfono</Label>
        <Input
          id="profile-phone"
          name="phone"
          type="tel"
          defaultValue={phone}
          maxLength={20}
          autoComplete="tel"
          placeholder="+34 600 123 456"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="flex">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  )
}
