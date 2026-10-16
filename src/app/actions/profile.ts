"use server"

import { requireUser } from "@/server/auth/guards"
import { hashPassword, verifyPassword } from "@/server/auth/password"
import { saveProfile } from "@/server/auth/profile"
import { findUserById, updatePassword } from "@/server/auth/users"
import { AppError } from "@/server/umejson/types"

export interface UpdateProfileState {
  error: string | null
  success: string | null
}

export interface ChangePasswordState {
  error: string | null
  success: string | null
}

const PHONE_RE = /^\+?[\d\s().-]{7,20}$/
const FULL_NAME_MAX = 100

export async function updateProfileAction(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const user = await requireUser()

  const fullName = String(formData.get("fullName") ?? "")
    .trim()
    .replace(/\s+/g, " ")
  const phone = String(formData.get("phone") ?? "").trim()

  if (fullName.length > FULL_NAME_MAX) {
    return {
      error: `El nombre completo no puede superar ${FULL_NAME_MAX} caracteres`,
      success: null,
    }
  }
  if (phone && !PHONE_RE.test(phone)) {
    return {
      error: "Introduce un teléfono válido (7 a 20 dígitos; puede incluir +, espacios, paréntesis o guiones)",
      success: null,
    }
  }

  try {
    const { changed } = await saveProfile(user, { fullName, phone })
    return {
      error: null,
      success: changed ? "Perfil actualizado" : "Sin cambios que guardar",
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "version_conflict") {
      return {
        error: "Los datos se modificaron en otra sesión. Recarga la página e inténtalo de nuevo.",
        success: null,
      }
    }
    throw error
  }
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const sessionUser = await requireUser()

  const currentPassword = String(formData.get("currentPassword") ?? "")
  const newPassword = String(formData.get("newPassword") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "Todos los campos son obligatorios", success: null }
  }
  if (newPassword.length < 8) {
    return {
      error: "La nueva contraseña debe tener al menos 8 caracteres",
      success: null,
    }
  }
  if (newPassword !== confirmPassword) {
    return { error: "Las contraseñas no coinciden", success: null }
  }

  const user = await findUserById(sessionUser.id)
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { error: "La contraseña actual no es correcta", success: null }
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    return {
      error: "La nueva contraseña debe ser distinta de la actual",
      success: null,
    }
  }

  await updatePassword(user.id, await hashPassword(newPassword))
  return { error: null, success: "Contraseña actualizada" }
}
