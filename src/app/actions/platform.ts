"use server"

import { revalidatePath } from "next/cache"

import {
  isPlatformRole,
  type UserRole,
} from "@/server/auth/types"
import { requireApiUser } from "@/server/auth/api"
import { AppError } from "@/server/umejson/types"
import {
  createTenant,
  resetTenantOwnerPassword,
  setTenantStatus,
  type CreatedTenant,
} from "@/server/tenants/platform"

/**
 * Acciones de la CONSOLA DE PLATAFORMA (§2.4): requieren sesión de plataforma
 * (rol `plataforma`, tenant_id NULL) en el host de plataforma. Cualquier otra
 * sesión responde 404-like (la página ya filtra).
 */

export interface PlatformActionState {
  error: string | null
  created: CreatedTenant | null
  temporaryPassword: string | null
}

async function requirePlatformSession() {
  const user = await requireApiUser("core")
  if (!user || !isPlatformRole(user.role as UserRole)) {
    throw new AppError(404, "no_autorizado", "Solo la consola de plataforma puede hacer esto.")
  }
  return user
}

export async function createTenantAction(
  _prev: PlatformActionState,
  formData: FormData
): Promise<PlatformActionState> {
  try {
    await requirePlatformSession()
    const created = await createTenant({
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      ownerEmail: String(formData.get("ownerEmail") ?? ""),
    })
    revalidatePath("/platform")
    return { error: null, created, temporaryPassword: created.temporaryPassword }
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message, created: null, temporaryPassword: null }
    }
    return {
      error: "No fue posible crear el tenant.",
      created: null,
      temporaryPassword: null,
    }
  }
}

export async function setTenantStatusAction(
  tenantId: string,
  status: "active" | "suspended"
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requirePlatformSession()
    await setTenantStatus(tenantId, status)
    revalidatePath("/platform")
    return { ok: true }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: "No fue posible cambiar el estado." }
  }
}

export async function resetTenantOwnerPasswordAction(
  tenantId: string
): Promise<{ ok: boolean; password?: string; error?: string }> {
  try {
    await requirePlatformSession()
    const password = await resetTenantOwnerPassword(tenantId)
    return { ok: true, password }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: "No fue posible restablecer la contraseña." }
  }
}
