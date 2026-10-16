import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { RegisterForm } from "@/components/auth/register-form"
import { getSessionUser } from "@/server/auth/session"

export const instant = false

export const metadata = {
  title: "Create account",
}

export default async function RegisterPage() {
  const user = await getSessionUser()
  if (user) {
    redirect("/entities")
  }

  return (
    <AuthShell>
      <RegisterForm />
    </AuthShell>
  )
}
