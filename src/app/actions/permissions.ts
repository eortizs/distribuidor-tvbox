"use server"

import { revalidatePath } from "next/cache"

import { getSessionUser } from "@/server/auth/session"
import { isSectionKey, setSectionPermissions } from "@/server/auth/permissions"
import { findUserById } from "@/server/auth/users"

export interface UpdatePermissionsState {
  error: string | null
  success: string | null
}

/**
 * Parsea un tope de cupón del form (diario o mensual): vacío = valor global
 * del servidor (null); si viene, entero positivo razonable (evita topes
 * absurdos). Devuelve el valor o el mensaje de error de validación.
 */
function parseCouponLimit(
  formData: FormData,
  field: string
): { value: number | null; error: string | null } {
  const raw = String(formData.get(field) ?? "").trim()
  if (raw.length === 0) return { value: null, error: null }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    return {
      value: null,
      error: `El campo '${field === "couponDailyLimit" ? "Cupones por día" : "Cupones por mes"}' debe ser un entero entre 1 y 1000`,
    }
  }
  return { value, error: null }
}

export async function updateUserPermissionsAction(
  _prev: UpdatePermissionsState,
  formData: FormData
): Promise<UpdatePermissionsState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const userId = String(formData.get("userId") ?? "")
  const target = await findUserById(userId)
  if (!target) {
    return { error: "User not found", success: null }
  }

  const sections = formData
    .getAll("sections")
    .map((value) => String(value))
    .filter(isSectionKey)
  if (sections.length === 0) {
    return { error: "Deja al menos una sección visible", success: null }
  }

  // Topes de cupón del comprador (diario y mensual acumulado): vacío =
  // valor global del servidor.
  const daily = parseCouponLimit(formData, "couponDailyLimit")
  if (daily.error) return { error: daily.error, success: null }
  const monthly = parseCouponLimit(formData, "couponMonthlyLimit")
  if (monthly.error) return { error: monthly.error, success: null }

  await setSectionPermissions(userId, sections, daily.value, monthly.value)

  revalidatePath("/users")
  return {
    error: null,
    success: `Permisos de '${target.username}' actualizados`,
  }
}
