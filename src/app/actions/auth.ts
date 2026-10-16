"use server"

import { redirect } from "next/navigation"

import { createSession, destroySession } from "@/server/auth/session"
import { findUserByUsername } from "@/server/auth/users"
import { verifyPassword } from "@/server/auth/password"

export interface LoginState {
  error: string | null
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  if (!username || !password) {
    return { error: "Username and password are required" }
  }

  const user = await findUserByUsername(username)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid credentials" }
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
