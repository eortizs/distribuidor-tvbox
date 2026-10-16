import { redirect } from "next/navigation"

import { LoginForm } from "@/components/auth/login-form"
import { getSessionUser } from "@/server/auth/session"

export const instant = false

export const metadata = {
  title: "Sign in",
}

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) {
    redirect("/entities")
  }

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center p-4">
      <div className="mb-6 flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-xs text-sm font-semibold">
          A
        </div>
        <span className="text-lg font-semibold tracking-tight">Acme Inc</span>
      </div>
      <LoginForm />
    </div>
  )
}
