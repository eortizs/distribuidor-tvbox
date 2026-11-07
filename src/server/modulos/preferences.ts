import { pool } from "@/server/db"
import { publishRealtimeDetached } from "@/server/realtime/bus"

import {
  normalizeModulePrefs,
  type ModulePrefs,
} from "@/lib/modulos"

/**
 * Preferencias del hub de módulos por usuario (favoritos, filtros creados
 * y asignaciones). Fuente de verdad en la base: web y mobile comparten el
 * mismo estado; cada guardado difunde un evento `prefs` (solo-propietario)
 * por el bus SSE para que el otro dispositivo refresque.
 */

export async function getModulePrefs(userId: string): Promise<ModulePrefs | null> {
  const result = await pool.query(
    "SELECT prefs FROM user_module_prefs WHERE user_id = $1",
    [userId]
  )
  if (result.rowCount === 0) return null
  return normalizeModulePrefs(result.rows[0].prefs)
}

export async function saveModulePrefs(
  userId: string,
  input: unknown
): Promise<ModulePrefs> {
  const prefs = normalizeModulePrefs(input)
  await pool.query(
    `INSERT INTO user_module_prefs (user_id, prefs, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE
        SET prefs = $2::jsonb, updated_at = now()`,
    [userId, JSON.stringify(prefs)]
  )
  publishRealtimeDetached({
    kind: "prefs",
    entityId: userId,
    distribuidorId: userId,
  })
  return prefs
}
