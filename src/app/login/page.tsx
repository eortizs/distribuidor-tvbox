import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { getSessionUser } from "@/server/auth/session"

export const instant = false

export const metadata = {
  title: "Iniciar sesión",
}

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) {
    redirect("/clientes")
  }

  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  )
}
