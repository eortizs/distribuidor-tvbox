import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { homePathForUser } from "@/server/auth/types"
import { googleFlowForRequest } from "@/server/auth/google-host"
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
  google_host_mismatch:
    "Esta cuenta pertenece a otro panel. Inicia sesión desde el dominio de tu panel.",
  google_other_panel:
    "Esa cuenta de Google ya está registrada en otro panel. Inicia sesión desde el dominio de tu panel.",
  google_not_registered:
    "No hay una cuenta con ese correo en este panel. Pide al propietario que te dé de alta.",
  google_link_required:
    "Para usar Google con tu cuenta, inicia sesión con tu contraseña: quedará vinculada para las próximas veces.",
  handoff_invalid:
    "El enlace de bienvenida ya se usó o expiró. Inicia sesión con tu correo y contraseña.",
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
    // Destino por perfil (§6.9): plataforma → consola, afiliado → portal.
    redirect(homePathForUser(user))
  }

  const oauthCode = params.error
  const isNotice = oauthCode != null && oauthCode in OAUTH_NOTICES

  // Google OAuth por host: el panel legado usa su cliente y cada tenant
  // `*.spei.link` el cliente SPEILink (relevo por la URI fija); sin el
  // cliente del host configurado el botón se oculta.
  const { requestHost } = await import("@/server/tenant/request-host")
  const { resolveTenantHost } = await import("@/server/tenant/hosts")
  const currentHost = await requestHost()
  const hostKind = resolveTenantHost(currentHost).kind
  const googleEnabled = (await googleFlowForRequest()) !== null

  return (
    <AuthShell>
      <LoginForm
        googleEnabled={googleEnabled}
        registerEnabled={hostKind === "legacy"}
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
