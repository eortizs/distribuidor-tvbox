"use server"

import { redirect } from "next/navigation"

import { createSession, destroySession } from "@/server/auth/session"
import { findUserByUsername } from "@/server/auth/users"
import { createAccount } from "@/server/auth/accounts"
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
    return { error: "Email and password are required" }
  }
  if (!isValidEmail(email)) {
    return { error: "Login must be a valid email address" }
  }

  const user = await findUserByUsername(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Invalid credentials" }
  }

  await createSession({
    id: user.id,
    username: user.username,
    role: user.role,
  })

  redirect("/entities")
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

  redirect("/entities")
}

export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect("/login")
}
