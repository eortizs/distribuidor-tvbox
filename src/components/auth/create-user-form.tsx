"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createUserAction, type CreateUserState } from "@/app/actions/users"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const initialState: CreateUserState = { error: null, success: null }

export function CreateUserForm() {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    createUserAction,
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
        <Label htmlFor="new-username">Username</Label>
        <Input id="new-username" name="username" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">Password</Label>
        <Input id="new-password" name="password" type="password" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-role">Role</Label>
        <Select name="role" defaultValue="distribuidor">
          <SelectTrigger id="new-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="distribuidor">distribuidor</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Creating…" : "Create user"}
      </Button>
    </form>
  )
}
