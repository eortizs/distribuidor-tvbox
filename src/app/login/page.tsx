import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { isGoogleAuthEnabled } from "@/server/auth/google"
import { getSessionUser } from "@/server/auth/session"

export const instant = false

export const metadata = {
  title: "Iniciar sesión",
}

const OAUTH_ERRORS: Record<string, string> = {
  google_disabled: "El acceso con Google no está disponible en este momento.",
  google_cancelled: "Cancelaste el inicio de sesión con Google.",
  google_state: "La sesión con Google expiró; inténtalo de nuevo.",
  google_invalid: "No se pudo iniciar sesión con Google.",
  google_failed: "No se pudo iniciar sesión con Google.",
  google_linked_other:
    "Ese correo ya está ligado a otra cuenta de Google.",
  google_link_required:
    "Para usar Google con tu cuenta, inicia sesión con tu contraseña: quedará vinculada para las próximas veces.",
}

const OAUTH_NOTICES: Record<string, string> = {
  google_link_required: OAUTH_ERRORS.google_link_required,
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams])
  if (user) {
    redirect("/clientes")
  }

  const oauthCode = params.error
  const isNotice = oauthCode != null && oauthCode in OAUTH_NOTICES

  return (
    <AuthShell>
      <LoginForm
        googleEnabled={isGoogleAuthEnabled()}
        oauthError={
          oauthCode && !isNotice
            ? (OAUTH_ERRORS[oauthCode] ?? OAUTH_ERRORS.google_failed)
            : null
        }
        oauthNotice={isNotice ? (oauthCode ? OAUTH_NOTICES[oauthCode] : null) : null}
      />
    </AuthShell>
  )
}
