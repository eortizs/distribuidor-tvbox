import { NextResponse, connection, type NextRequest } from "next/server"

import { createSession } from "@/server/auth/session"
import {
  GOOGLE_LINK_COOKIE,
  GOOGLE_STATE_COOKIE,
  buildGoogleRedirectUri,
  createGoogleLinkToken,
  exchangeGoogleCode,
  googleLinkCookieOptions,
  googleStateCookieOptions,
  isGoogleAuthEnabled,
  publicOrigin,
  verifyGoogleState,
} from "@/server/auth/google"
import {
  findUserByGoogleSub,
  findUserByUsername,
  updateUser,
} from "@/server/auth/users"
import { createAccount } from "@/server/auth/accounts"
import { populateFullNameFromGoogle } from "@/server/auth/profile"
import { normalizeEmail, type AuthUser } from "@/server/auth/types"
import { AppError } from "@/server/umejson/types"

type Resolution =
  | { kind: "session"; user: AuthUser; storedPicture: string | null }
  | { kind: "link" }
  | { kind: "conflict" }

function toSessionUser(user: {
  id: string
  username: string
  role: AuthUser["role"]
  googlePicture: string | null
}): { user: AuthUser; storedPicture: string | null } {
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      googlePicture: user.googlePicture,
    },
    storedPicture: user.googlePicture,
  }
}

/**
 * Resuelve la cuenta para una identidad Google verificada: por google_sub,
 * luego por correo (vínculo pendiente de prueba por contraseña) o creándola
 * como distribuidor. Si la creación pierde una carrera (23505, otra petición
 * creó la cuenta primero), reintenta la resolución con la fila ya existente.
 */
async function resolveGoogleUser(
  profile: { sub: string; email: string; picture: string | null; name: string | null },
  email: string
): Promise<Resolution> {
  // 1) Cuenta ya ligada por google_sub.
  const bySub = await findUserByGoogleSub(profile.sub)
  if (bySub) {
    return { kind: "session", ...toSessionUser(bySub) }
  }

  // 2) Cuenta local con el mismo correo: el dueño debe probar posesión
  //    iniciando sesión con su contraseña; el vínculo automático por correo
  //    no verificado permitiría adelantarse a la cuenta real.
  const local = await findUserByUsername(email)
  if (local) {
    if (local.googleSub && local.googleSub !== profile.sub) {
      return { kind: "conflict" }
    }
    if (!local.googleSub) {
      return { kind: "link" }
    }
    return { kind: "session", ...toSessionUser(local) }
  }

  // 3) Cuenta nueva de Google (distribuidor, sin contraseña local).
  try {
    const created = await createAccount({
      email,
      googleSub: profile.sub,
      googlePicture: profile.picture,
      fullName: profile.name ?? undefined,
      source: "google-oauth",
    })
    return {
      kind: "session",
      user: created,
      storedPicture: profile.picture,
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "email_taken") {
      // Carrera: otra petición registró el correo entre la consulta y el
      // INSERT; la resolución sobre la fila existente siempre termina.
      return resolveGoogleUser(profile, email)
    }
    throw error
  }
}

/**
 * Callback de Google OAuth. Valida el estado anti-CSRF, canjea el código y
 * resuelve la cuenta. Cualquier fallo vuelve a /login con un error genérico
 * para el comprador; el detalle queda en logs.
 *
 * `connection()` detiene el prerender del build: el estado y el código son
 * de una sola petición y nunca deben congelarse en salida estática.
 */
export async function GET(request: NextRequest) {
  await connection()
  const stateCookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value
  const origin = publicOrigin()

  const fail = (reason: string, log?: unknown) => {
    if (log) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `google-oauth: ${reason}`,
          detail: log instanceof Error ? log.message : String(log),
        })
      )
    }
    const url = new URL("/login", origin)
    url.searchParams.set("error", reason)
    const response = NextResponse.redirect(url)
    response.cookies.set(GOOGLE_STATE_COOKIE, "", {
      ...googleStateCookieOptions(),
      maxAge: 0,
    })
    return response
  }

  if (!isGoogleAuthEnabled()) {
    return fail("google_disabled")
  }

  const state = request.nextUrl.searchParams.get("state")
  const code = request.nextUrl.searchParams.get("code")
  const providerError = request.nextUrl.searchParams.get("error")

  if (providerError) {
    return fail("google_cancelled")
  }
  if (!state || !verifyGoogleState(stateCookie, state)) {
    return fail("google_state")
  }

  const response = NextResponse.redirect(new URL("/clientes", origin))
  // El estado es de un solo uso: se limpia aunque el resto del flujo falle.
  response.cookies.set(GOOGLE_STATE_COOKIE, "", {
    ...googleStateCookieOptions(),
    maxAge: 0,
  })

  if (!code) {
    return fail("google_invalid")
  }

  let profile: Awaited<ReturnType<typeof exchangeGoogleCode>>
  try {
    profile = await exchangeGoogleCode(code, buildGoogleRedirectUri())
  } catch (error) {
    return fail("google_failed", error)
  }

  const email = normalizeEmail(profile.email)

  let resolution: Resolution
  try {
    resolution = await resolveGoogleUser(profile, email)
  } catch (error) {
    return fail("google_failed", error)
  }

  if (resolution.kind === "conflict") {
    return fail("google_linked_other")
  }

  if (resolution.kind === "link") {
    const linkResponse = NextResponse.redirect(
      new URL("/login?error=google_link_required", origin)
    )
    linkResponse.cookies.set(GOOGLE_STATE_COOKIE, "", {
      ...googleStateCookieOptions(),
      maxAge: 0,
    })
    linkResponse.cookies.set(
      GOOGLE_LINK_COOKIE,
      createGoogleLinkToken(profile),
      googleLinkCookieOptions()
    )
    return linkResponse
  }

  // La foto de Google puede cambiar: se refresca la fila si difiere.
  if (profile.picture && profile.picture !== resolution.storedPicture) {
    await updateUser(resolution.user.id, {
      googlePicture: profile.picture,
    })
  }
  // El nombre completo de la entidad Cuenta se rellena solo si está vacío:
  // el campo es editable por el usuario y nunca se pisa una edición manual.
  if (profile.name) {
    await populateFullNameFromGoogle(
      resolution.user.id,
      profile.name,
      resolution.user.username
    )
  }
  await createSession(resolution.user)
  return response
}
