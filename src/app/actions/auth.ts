"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createSession, destroySession } from "@/server/auth/session"
import { findUserByUsername, updateUser } from "@/server/auth/users"
import { createAccount } from "@/server/auth/accounts"
import { populateFullNameFromGoogle } from "@/server/auth/profile"
import {
  GOOGLE_LINK_COOKIE,
  googleLinkCookieOptions,
  verifyGoogleLinkToken,
} from "@/server/auth/google"
import {
  isValidEmail,
  normalizeEmail,
  type AuthUser,
} from "@/server/auth/types"
import { verifyPassword } from "@/server/auth/password"
import { AppError } from "@/server/umejson/types"

export interface LoginState {
  error: string | null
}

export interface RegisterState {
  error: string | null
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("username") ?? ""))
  const password = String(formData.get("password") ?? "")

  if (!email || !password) {
    return { error: "El correo y la contraseña son obligatorios" }
  }
  if (!isValidEmail(email)) {
    return { error: "Ingresa un correo electrónico válido" }
  }

  const user = await findUserByUsername(email)
  if (
    !user ||
    !user.passwordHash ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    return { error: "Credenciales incorrectas" }
  }

  // Vínculo pendiente de Google: la contraseña acaba de probar que el que
  // inicia sesión es el dueño de la cuenta, así que el sub (con su foto y
  // nombre) puede enlazarse.
  const cookieStore = await cookies()
  const linkToken = verifyGoogleLinkToken(
    cookieStore.get(GOOGLE_LINK_COOKIE)?.value,
    user.username
  )
  if (linkToken && !user.googleSub) {
    await updateUser(user.id, {
      googleSub: linkToken.sub,
      // undefined = sin cambio: la foto solo se escribe si el token la trae.
      googlePicture: linkToken.picture ?? undefined,
    })
    if (linkToken.name) {
      // Solo rellena fullName si está vacío; nunca pisa ediciones manuales.
      await populateFullNameFromGoogle(user.id, linkToken.name, user.username)
    }
  }
  if (cookieStore.get(GOOGLE_LINK_COOKIE)) {
    cookieStore.set(GOOGLE_LINK_COOKIE, "", {
      ...googleLinkCookieOptions(),
      maxAge: 0,
    })
  }

  await createSession({
    id: user.id,
    username: user.username,
    role: user.role,
  })

  redirect("/clientes")
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""))
  const password = String(formData.get("password") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")

  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address" }
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  let user: AuthUser
  try {
    user = await createAccount({ email, password })
  } catch (error) {
    if (error instanceof AppError && error.code === "email_taken") {
      return { error: "An account with this email already exists" }
    }
    throw error
  }

  await createSession({
    id: user.id,
    username: user.username,
    role: user.role,
  })

  redirect("/clientes")
}

export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect("/login")
}
