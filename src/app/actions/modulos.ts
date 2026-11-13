"use server"

import { revalidatePath } from "next/cache"

import { getSessionUser } from "@/server/auth/session"
import { findUserById } from "@/server/auth/users"
import { requireUser } from "@/server/auth/guards"
import { saveModulePrefs } from "@/server/modulos/preferences"
import { setModuleVisibility } from "@/server/modulos/visibility"
import type { ModulePrefs } from "@/lib/modulos"

export interface SaveModulePrefsResult {
  ok: boolean
  /** Preferencias normalizadas tras el guardado; null si falló. */
  prefs: ModulePrefs | null
  error: string | null
}

/**
 * Guarda favoritos/filtros/asignaciones del hub de módulos del usuario
 * autenticado. Devuelve las preferencias normalizadas para que el cliente
 * adopte exactamente lo que quedó en el servidor.
 */
export async function saveModulePrefsAction(
  input: unknown
): Promise<SaveModulePrefsResult> {
  const user = await requireUser()
  const prefs = await saveModulePrefs(user.id, input)
  return { ok: true, prefs, error: null }
}

export interface UpdateUserModulesResult {
  ok: boolean
  error: string | null
}

/**
 * Guarda la visibilidad de módulos de una cuenta (solo admin): `visibleHrefs`
 * son los hrefs que quedan visibles en el hub `/modulos` de esa cuenta; el
 * resto del catálogo ajustable se marca oculto. El propio usuario recibe el
 * refresco por el bus de tiempo real.
 */
export async function updateUserModulesAction(
  userId: string,
  visibleHrefs: string[]
): Promise<UpdateUserModulesResult> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return {
      ok: false,
      error: "Solo un admin puede ajustar los módulos de una cuenta.",
    }
  }

  const target = await findUserById(userId)
  if (!target) {
    return { ok: false, error: "User not found" }
  }

  try {
    await setModuleVisibility(userId, visibleHrefs)
  } catch {
    return {
      ok: false,
      error: `No se pudo guardar la visibilidad de módulos de '${target.username}'.`,
    }
  }

  revalidatePath("/modulos/distribuidores")
  return { ok: true, error: null }
}
