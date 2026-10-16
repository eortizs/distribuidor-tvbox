"use server"

import { revalidatePath } from "next/cache"

import { getSessionUser } from "@/server/auth/session"
import { hashPassword } from "@/server/auth/password"
import { insertUser } from "@/server/auth/users"
import { isValidRole } from "@/server/auth/types"

export interface CreateUserState {
  error: string | null
  success: string | null
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const role = String(formData.get("role") ?? "")

  if (!USERNAME_RE.test(username)) {
    return {
      error: "Username must be 3-32 characters (letters, numbers, . _ -)",
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
    await insertUser({
      username,
      passwordHash: hashPassword(password),
      role,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("users_username_key") || message.includes("duplicate key")) {
      return { error: `Username '${username}' already exists`, success: null }
    }
    throw error
  }

  revalidatePath("/users")
  return { error: null, success: `User '${username}' created as ${role}` }
}
