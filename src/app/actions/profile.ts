"use server"

import { requireUser } from "@/server/auth/guards"
import { hashPassword, verifyPassword } from "@/server/auth/password"
import { saveProfile } from "@/server/auth/profile"
import { findUserById, updatePassword } from "@/server/auth/users"
import {
  clearUserMpToken,
  saveUserMpToken,
} from "@/server/mercadopago/tokens"
import { setWhatsAppPhone } from "@/server/whatsapp/service"
import { AppError } from "@/server/umejson/types"

export interface UpdateProfileState {
  error: string | null
  success: string | null
}

export interface ChangePasswordState {
  error: string | null
  success: string | null
}

const FULL_NAME_MAX = 100
const BANK_NAME_MAX = 60
const HOLDER_NAME_MAX = 100
const CLABE_RE = /^\d{18}$/

export async function updateProfileAction(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const user = await requireUser("core")

  const fullName = String(formData.get("fullName") ?? "")
    .trim()
    .replace(/\s+/g, " ")
  const whatsappPhone = String(formData.get("whatsappPhone") ?? "").trim()

  if (fullName.length > FULL_NAME_MAX) {
    return {
      error: `El nombre completo no puede superar ${FULL_NAME_MAX} caracteres`,
      success: null,
    }
  }

  try {
    // El teléfono quedó fuera del formulario: se omite la clave para no
    // tocar el valor ya guardado en la entidad Cuenta.
    const { changed } = await saveProfile(user, { fullName })
    // WhatsApp registrado del canal agente: columna propia en `users`
    // (índice único: un número = una cuenta). Solo se escribe si cambió y
    // cuenta en el mensaje de resultado (antes decía «Sin cambios» aunque
    // el número se hubiera guardado).
    const stored = await findUserById(user.id)
    const whatsappChanged = (stored?.whatsappPhone ?? "") !== whatsappPhone
    if (whatsappChanged) {
      await setWhatsAppPhone(
        user.id,
        whatsappPhone === "" ? null : whatsappPhone
      )
    }
    return {
      error: null,
      success:
        changed || whatsappChanged
          ? "Perfil actualizado"
          : "Sin cambios que guardar",
    }
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "version_conflict") {
        return {
          error: "Los datos se modificaron en otra sesión. Recarga la página e inténtalo de nuevo.",
          success: null,
        }
      }
      return { error: error.message, success: null }
    }
    throw error
  }
}

export async function updateBankingAction(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const user = await requireUser("core")

  const bankName = String(formData.get("bankName") ?? "").trim()
  const bankHolder = String(formData.get("bankHolder") ?? "").trim()
  const bankClabe = String(formData.get("bankClabe") ?? "")
    .trim()
    .replace(/\s+/g, "")
  // WRITE-ONLY: el token nunca viaja de vuelta al navegador; el campo llega
  // vacío cuando el usuario no lo está (re)registrando y entonces no se toca.
  const mpToken = String(formData.get("mpToken") ?? "").trim()

  if (bankName.length > BANK_NAME_MAX) {
    return {
      error: `El banco no puede superar ${BANK_NAME_MAX} caracteres`,
      success: null,
    }
  }
  if (bankHolder.length > HOLDER_NAME_MAX) {
    return {
      error: `El destinatario no puede superar ${HOLDER_NAME_MAX} caracteres`,
      success: null,
    }
  }
  if (bankClabe && !CLABE_RE.test(bankClabe)) {
    return {
      error: "La CLABE debe tener exactamente 18 dígitos",
      success: null,
    }
  }

  try {
    const { changed } = await saveProfile(user, {
      bankName,
      bankHolder,
      bankClabe,
    })

    // Token de Mercado Pago propio: se valida contra MP antes de cifrarse;
    // un token rechazado deja el error inline y NO guarda nada del token.
    let tokenChanged = false
    if (mpToken.length > 0) {
      await saveUserMpToken(user.id, mpToken)
      tokenChanged = true
    }

    return {
      error: null,
      success:
        changed || tokenChanged
          ? tokenChanged
            ? "Datos actualizados; token de Mercado Pago vinculado"
            : "Datos bancarios actualizados"
          : "Sin cambios que guardar",
    }
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "version_conflict") {
        return {
          error: "Los datos se modificaron en otra sesión. Recarga la página e inténtalo de nuevo.",
          success: null,
        }
      }
      return { error: error.message, success: null }
    }
    throw error
  }
}

/**
 * Quita el token propio de Mercado Pago del usuario en sesión. Acción PLAIN
 * (sin el contrato de formulario): la llama la UI con una transacción porque
 * el botón vive DENTRO del formulario de datos bancarios y un <form>
 * anidado es HTML inválido.
 */
export async function clearMpToken(): Promise<UpdateProfileState> {
  const user = await requireUser("core")
  try {
    await clearUserMpToken(user.id)
    return {
      error: null,
      success: "Token de Mercado Pago eliminado",
    }
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message, success: null }
    }
    throw error
  }
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const sessionUser = await requireUser("core")

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
  if (!user || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
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
