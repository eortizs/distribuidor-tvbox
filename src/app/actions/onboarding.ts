"use server"

import { revalidatePath } from "next/cache"

import { requireUser } from "@/server/auth/guards"
import { isOwnerRole } from "@/server/auth/types"
import {
  businessTenantIdOfUser,
  getTenantMpTokenStatus,
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
  /** Cambiar el WhatsApp declarado exige confirmación (paso 3). */
  needsReplaceConfirm?: boolean
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
 * Paso «Vincula tu cuenta de Mercado Pago» (flujo del dueño: CLABE + access
 * token JUNTOS): guarda el token y la cuenta de cobro en una sola pantalla.
 * El token es opcional SI ya hay uno activo (solo cambia la CLABE); con
 * token nuevo se valida contra Mercado Pago al instante.
 */
export async function saveBusinessMpLinkAction(
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
    if (mpToken.startsWith("TEST-")) {
      return {
        error: "Es un token de PRUEBA (TEST-). Pega el access token de PRODUCCIÓN de tu cuenta de Mercado Pago.",
        success: null,
      }
    }
    await saveTenantBanking(tenantId, {
      bankName: String(formData.get("bankName") ?? ""),
      bankHolder: String(formData.get("bankHolder") ?? ""),
      bankClabe: String(formData.get("bankClabe") ?? ""),
    })
    let tokenStatus: TenantMpTokenStatus | null = null
    if (mpToken.length > 0) {
      tokenStatus = await saveTenantMpToken(tenantId, mpToken)
    } else {
      const existing = await getTenantMpTokenStatus(tenantId)
      if (!existing || existing.status !== "active") {
        return {
          error: "Pega el access token de producción de tu cuenta de Mercado Pago (o conecta uno antes).",
          success: null,
        }
      }
    }
    revalidatePath("/onboarding")
    revalidatePath("/profile")
    return {
      error: null,
      success: "Cuenta de Mercado Pago vinculada",
      tokenStatus,
    }
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
      String(formData.get("whatsappNumber") ?? ""),
      // Cambiar un número ya declarado exige confirmación (borra la sesión
      // y pide QR nuevo); el checkbox del panel la envía en el reintento.
      { replaceLinked: formData.get("confirmReplace") === "on" }
    )
    revalidatePath("/onboarding")
    revalidatePath("/profile")
    revalidatePath("/modulos/whatsapp")
    return {
      error: null,
      success: `WhatsApp del negocio declarado (+${number}). Vincúlalo por QR en Módulos → WhatsApp.`,
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "whatsapp_cambio_confirmar") {
      return {
        error: error.message,
        success: null,
        needsReplaceConfirm: true,
      }
    }
    return errorState(error)
  }
}
