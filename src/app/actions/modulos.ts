"use server"

import { requireUser } from "@/server/auth/guards"
import { saveModulePrefs } from "@/server/modulos/preferences"
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
