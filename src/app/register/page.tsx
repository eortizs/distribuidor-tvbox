import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { RegisterForm } from "@/components/auth/register-form"
import { isGoogleAuthEnabled } from "@/server/auth/google"
import { getSessionUser } from "@/server/auth/session"

export const instant = false

export const metadata = {
  title: "Crear cuenta",
}

export default async function RegisterPage() {
  const user = await getSessionUser()
  if (user) {
    redirect("/clientes")
  }

  return (
    <AuthShell>
      <RegisterForm googleEnabled={isGoogleAuthEnabled()} />
    </AuthShell>
  )
}
