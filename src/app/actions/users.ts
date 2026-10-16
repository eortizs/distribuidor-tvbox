"use server"

import { revalidatePath } from "next/cache"

import { getSessionUser } from "@/server/auth/session"
import { createAccount } from "@/server/auth/accounts"
import {
  isValidEmail,
  isValidRole,
  normalizeEmail,
} from "@/server/auth/types"
import { AppError } from "@/server/umejson/types"

export interface CreateUserState {
  error: string | null
  success: string | null
}

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const email = normalizeEmail(String(formData.get("username") ?? ""))
  const password = String(formData.get("password") ?? "")
  const role = String(formData.get("role") ?? "")

  if (!isValidEmail(email)) {
    return {
      error: "Username must be a valid email address",
      success: null,
    }
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters", success: null }
  }
  if (!isValidRole(role)) {
    return { error: "Role must be admin or distribuidor", success: null }
  }

  try {
    await createAccount({
      email,
      password,
      role,
      actor: `user:${session.username}`,
      source: "admin",
    })
  } catch (error) {
    if (error instanceof AppError && error.code === "email_taken") {
      return { error: `Email '${email}' already exists`, success: null }
    }
    throw error
  }

  revalidatePath("/users")
  return { error: null, success: `Account '${email}' created as ${role}` }
}
