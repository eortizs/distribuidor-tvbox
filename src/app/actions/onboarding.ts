"use server"

import { revalidatePath } from "next/cache"

import { requireUser } from "@/server/auth/guards"
import { isOwnerRole } from "@/server/auth/types"
import {
  businessTenantIdOfUser,
  saveTenantBanking,
  saveTenantMpToken,
  saveTenantWhatsappNumber,
  type TenantMpTokenStatus,
} from "@/server/tenants/business"
import { AppError } from "@/server/umejson/types"

/**
 * Acciones del asistente de configuración (Fase 1, §4.3): los pasos 1 (token
 * de Mercado Pago del negocio) y 2 (cuenta donde recibe). El propietario de
 * un negocio edita; la misma vía sirve en Perfil — updateBusinessBankingAction
 * reusa ESTAS acciones para que la validación no se duplique.
 */

export interface BusinessSetupState {
  error: string | null
  success: string | null
  /** Estado del token tras validar (paso 1): cuenta y últimos 4. */
  tokenStatus?: TenantMpTokenStatus | null
}

/** Tenant de negocio de la sesión; error listo para el form si no aplica. */
async function businessTenantOfSession(
  userId: string,
  role: string
): Promise<string | { error: string }> {
  const tenantId = await businessTenantIdOfUser(userId)
  if (!tenantId) return "Tu cuenta no pertenece a un negocio."
  if (!isOwnerRole(role)) return "Solo el propietario puede editar los datos del negocio."
  return tenantId
}

function errorState(error: unknown): BusinessSetupState {
  if (error instanceof AppError) {
    return { error: error.message, success: null }
  }
  throw error
}

/** Paso 1 del asistente: conecta la cuenta de Mercado Pago del negocio. */
export async function saveBusinessMpTokenAction(
  _prev: BusinessSetupState,
  formData: FormData
): Promise<BusinessSetupState> {
  try {
    const sessionUser = await requireUser("core")
    const tenantId = await businessTenantOfSession(sessionUser.id, sessionUser.role)
    if (typeof tenantId !== "string") {
      return { error: tenantId.error, success: null }
    }
    const mpToken = String(formData.get("mpToken") ?? "").trim()
    if (mpToken.length === 0) {
      return { error: "Pega el access token de producción de tu cuenta de Mercado Pago.", success: null }
    }
    // Rechazo temprano de tokens de prueba (el flujo del panel es producción).
    if (mpToken.startsWith("TEST-")) {
      return {
        error: "Es un token de PRUEBA (TEST-). Pega el access token de PRODUCCIÓN de tu cuenta de Mercado Pago.",
        success: null,
      }
    }
    const tokenStatus = await saveTenantMpToken(tenantId, mpToken)
    revalidatePath("/onboarding")
    revalidatePath("/profile")
    return {
      error: null,
      success: "Cuenta de Mercado Pago conectada",
      tokenStatus,
    }
  } catch (error) {
    return errorState(error)
  }
}

/** Paso 2 del asistente: la cuenta donde recibe los pagos (banco/CLABE). */
export async function saveBusinessBankingAction(
  _prev: BusinessSetupState,
  formData: FormData
): Promise<BusinessSetupState> {
  try {
    const sessionUser = await requireUser("core")
    const tenantId = await businessTenantOfSession(sessionUser.id, sessionUser.role)
    if (typeof tenantId !== "string") {
      return { error: tenantId.error, success: null }
    }
    await saveTenantBanking(tenantId, {
      bankName: String(formData.get("bankName") ?? ""),
      bankHolder: String(formData.get("bankHolder") ?? ""),
      bankClabe: String(formData.get("bankClabe") ?? ""),
    })
    revalidatePath("/onboarding")
    revalidatePath("/profile")
    return { error: null, success: "Cuenta para recibir pagos guardada" }
  } catch (error) {
    return errorState(error)
  }
}

/**
 * Paso 3 del asistente: declara el WhatsApp del negocio. La vinculación por
 * QR/código de emparejamiento vive en el módulo WhatsApp (fase 2B).
 */
export async function saveBusinessWhatsappNumberAction(
  _prev: BusinessSetupState,
  formData: FormData
): Promise<BusinessSetupState> {
  try {
    const sessionUser = await requireUser("core")
    const tenantId = await businessTenantOfSession(sessionUser.id, sessionUser.role)
    if (typeof tenantId !== "string") {
      return { error: tenantId.error, success: null }
    }
    const number = await saveTenantWhatsappNumber(
      tenantId,
      String(formData.get("whatsappNumber") ?? "")
    )
    revalidatePath("/onboarding")
    revalidatePath("/profile")
    return {
      error: null,
      success: `WhatsApp del negocio declarado (+${number}). Vincúlalo por QR en Módulos → WhatsApp.`,
    }
  } catch (error) {
    return errorState(error)
  }
}
