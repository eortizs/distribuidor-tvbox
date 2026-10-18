"use server"

import { revalidatePath } from "next/cache"

import { getSessionUser } from "@/server/auth/session"
import {
  createAccount,
  deleteAccount,
  updateAccount,
} from "@/server/auth/accounts"
import { hashPassword } from "@/server/auth/password"
import { countAdmins, findUserById } from "@/server/auth/users"
import {
  isValidEmail,
  isValidRole,
  normalizeEmail,
  type UserRole,
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

export interface UpdateUserState {
  error: string | null
  success: string | null
}

export async function updateUserAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const userId = String(formData.get("userId") ?? "")
  const username = normalizeEmail(String(formData.get("username") ?? ""))
  const role = String(formData.get("role") ?? "")
  const newPassword = String(formData.get("newPassword") ?? "")

  const target = await findUserById(userId)
  if (!target) {
    return { error: "User not found", success: null }
  }

  const patch: {
    username?: string
    role?: UserRole
    passwordHash?: string
  } = {}

  if (username !== target.username) {
    if (!isValidEmail(username)) {
      return {
        error: "Username must be a valid email address",
        success: null,
      }
    }
    patch.username = username
  }
  if (role !== target.role) {
    if (!isValidRole(role)) {
      return { error: "Role must be admin or distribuidor", success: null }
    }
    if (target.role === "admin") {
      const admins = await countAdmins()
      if (admins <= 1) {
        return { error: "Cannot demote the last admin", success: null }
      }
    }
    patch.role = role
  }
  if (newPassword) {
    if (newPassword.length < 8) {
      return { error: "Password must be at least 8 characters", success: null }
    }
    patch.passwordHash = await hashPassword(newPassword)
  }

  if (Object.keys(patch).length === 0) {
    return { error: "No changes to save", success: null }
  }

  try {
    await updateAccount({
      userId: target.id,
      ...patch,
      actor: `user:${session.username}`,
    })
  } catch (error) {
    if (error instanceof AppError && error.code === "email_taken") {
      return { error: `Email '${username}' already exists`, success: null }
    }
    throw error
  }

  revalidatePath("/users")
  const finalUsername = patch.username ?? target.username
  const changes = [
    patch.username ? "email" : null,
    patch.role ? "role" : null,
    patch.passwordHash ? "password" : null,
  ].filter(Boolean)
  return {
    error: null,
    success: `Account '${finalUsername}' updated (${changes.join(", ")})`,
  }
}

export interface DeleteUserState {
  error: string | null
  success: string | null
}

export async function deleteUserAction(
  _prev: DeleteUserState,
  formData: FormData
): Promise<DeleteUserState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const userId = String(formData.get("userId") ?? "")
  const target = await findUserById(userId)
  if (!target) {
    return { error: "User not found", success: null }
  }
  if (target.id === session.id) {
    return { error: "You cannot delete your own account", success: null }
  }
  if (target.role === "admin") {
    const admins = await countAdmins()
    if (admins <= 1) {
      return { error: "Cannot delete the last admin", success: null }
    }
  }

  await deleteAccount({
    userId: target.id,
    actor: `user:${session.username}`,
  })

  revalidatePath("/users")
  return {
    error: null,
    success: `Account '${target.username}' deleted`,
  }
}
