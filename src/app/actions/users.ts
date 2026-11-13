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
import { getAccountDistribuidorName } from "@/server/auth/accounts"
import { isValidEmail, isValidRole, normalizeEmail, type UserRole } from "@/server/auth/types"
import { DISTRIBUTOR_LINK_NONE } from "@/lib/distributor-link"
import { parseAbonoAmount, parseSaldoTipo } from "@/lib/saldo"
import { formatMxn } from "@/lib/finanzas"
import { ajustarSaldoAdmin } from "@/server/saldo/service"
import { setWhatsAppPhone } from "@/server/whatsapp/service"
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
  const distribuidorRaw = String(formData.get("distribuidorName") ?? "").trim()
  const distribuidorName =
    distribuidorRaw === DISTRIBUTOR_LINK_NONE || distribuidorRaw === ""
      ? ""
      : distribuidorRaw.slice(0, 120)

  const target = await findUserById(userId)
  if (!target) {
    return { error: "User not found", success: null }
  }
  const currentDistribuidor = (await getAccountDistribuidorName(userId)) ?? ""

  const patch: {
    username?: string
    role?: UserRole
    passwordHash?: string
    distribuidorName?: string
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
  if (distribuidorName !== currentDistribuidor) {
    patch.distribuidorName = distribuidorName
  }

  // WhatsApp registrado del canal agente (users.whatsapp_phone): vacío =
  // quitar el registro. La normalización/validación/unicidad viven en
  // setWhatsAppPhone (dígitos con código de país, número = una cuenta).
  // Se aplica DESPUÉS de updateAccount para no dejar un cambio parcial si la
  // edición compuesta falla (email duplicado, entidad Cuenta ausente...).
  const whatsappRaw = String(formData.get("whatsappPhone") ?? "").trim()
  const whatsappChanged = whatsappRaw !== (target.whatsappPhone ?? "")

  if (Object.keys(patch).length === 0 && !whatsappChanged) {
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
    if (error instanceof AppError && error.code === "account_entity_missing") {
      return {
        error:
          "This user has no account entity to link the distributor to; contact support",
        success: null,
      }
    }
    throw error
  }

  if (whatsappChanged) {
    try {
      await setWhatsAppPhone(target.id, whatsappRaw === "" ? null : whatsappRaw)
    } catch (error) {
      if (error instanceof AppError) {
        return { error: error.message, success: null }
      }
      throw error
    }
  }

  revalidatePath("/users")
  const finalUsername = patch.username ?? target.username
  const changes = [
    patch.username ? "email" : null,
    patch.role ? "role" : null,
    patch.passwordHash ? "password" : null,
    patch.distribuidorName !== undefined
      ? patch.distribuidorName === ""
        ? "reseller unlinked"
        : `reseller '${patch.distribuidorName}'`
      : null,
    whatsappChanged
      ? whatsappRaw === ""
        ? "whatsapp removed"
        : "whatsapp updated"
      : null,
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

export interface AdjustSaldoState {
  error: string | null
  success: string | null
}

/**
 * Abono directo de saldo a la cuenta de un usuario (solo admin, desde
 * `/users`): acredita tokens o cupones sin pasar por el checkout de pagos.
 * El monto usa la misma validación del módulo «Abonar saldo» y el
 * movimiento queda trazado como ajuste con el admin responsable.
 */
export async function adjustUserSaldoAction(
  _prev: AdjustSaldoState,
  formData: FormData
): Promise<AdjustSaldoState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const userId = String(formData.get("userId") ?? "")
  const tipo = parseSaldoTipo(formData.get("tipo"))
  const parsed = parseAbonoAmount(formData.get("amount"))
  if (!userId) {
    return { error: "User not found", success: null }
  }
  if (!tipo) {
    return {
      error: "El tipo de saldo debe ser tokens o cupones.",
      success: null,
    }
  }
  if (!parsed.ok) {
    return { error: parsed.message, success: null }
  }

  const target = await findUserById(userId)
  if (!target) {
    return { error: "User not found", success: null }
  }

  try {
    await ajustarSaldoAdmin({
      targetUserId: target.id,
      tipo,
      amount: parsed.amount,
      adminUserId: session.id,
    })
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo acreditar el saldo.",
      success: null,
    }
  }

  revalidatePath("/users")
  return {
    error: null,
    success: `Abono directo de ${formatMxn(parsed.amount)} en ${tipo} acreditado a ${target.username}.`,
  }
}
