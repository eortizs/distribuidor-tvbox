import { pool, withTransaction } from "@/server/db"
import { publishRealtime } from "@/server/realtime/bus"
import { navSectionKeys } from "@/components/dashboard/nav-config"
import type { AuthUser } from "./types"

/**
 * Permisos de secciones de la barra inferior por usuario. Solo afectan a la
 * visibilidad de la navegación (las rutas siguen servidas); las cuentas
 * admin siempre ven todo. Sin filas para un usuario = acceso completo.
 */

const ALL_KEYS = navSectionKeys

export function isSectionKey(value: string): boolean {
  return ALL_KEYS.includes(value)
}

/** Claves de sección visibles para un usuario (respetando el rol admin). */
export async function getVisibleSectionKeys(user: AuthUser): Promise<string[]> {
  if (user.role === "admin") {
    return [...ALL_KEYS]
  }
  const result = await pool.query(
    "SELECT section FROM user_section_permissions WHERE user_id = $1 AND visible",
    [user.id]
  )
  if (result.rowCount === 0) {
    return [...ALL_KEYS]
  }
  return result.rows
    .map((row) => row.section as string)
    .filter((key) => isSectionKey(key))
}

/** Secciones denegadas para cada usuario del listado (para la matriz). */
export async function listDeniedSectionsByUser(): Promise<
  Map<string, string[]>
> {
  const result = await pool.query(
    `SELECT user_id, array_agg(section) AS denied
       FROM user_section_permissions
      WHERE NOT visible
      GROUP BY user_id`
  )
  const denied = new Map<string, string[]>()
  for (const row of result.rows) {
    denied.set(
      row.user_id as string,
      (row.denied as string[]).filter((key) => isSectionKey(key))
    )
  }
  return denied
}

/**
 * Guarda la matriz completa de un usuario: una fila por sección con su
 * visibilidad. `visibleKeys` debe incluir al menos una sección. Los topes de
 * cupón (`couponDailyLimit` diario y `couponMonthlyLimit` acumulado, null =
 * valor global del servidor) se persisten en la misma transacción y con el
 * mismo evento de refresco.
 */
export async function setSectionPermissions(
  userId: string,
  visibleKeys: string[],
  couponDailyLimit: number | null,
  couponMonthlyLimit: number | null
): Promise<void> {
  const unique = [...new Set(visibleKeys)]
  if (unique.length === 0) {
    throw new Error("At least one section must stay visible")
  }
  if (unique.some((key) => !isSectionKey(key))) {
    throw new Error("Unknown section key")
  }
  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM user_section_permissions WHERE user_id = $1",
      [userId]
    )
    for (const key of ALL_KEYS) {
      await client.query(
        `INSERT INTO user_section_permissions (user_id, section, visible)
         VALUES ($1, $2, $3)`,
        [userId, key, unique.includes(key)]
      )
    }
    await client.query(
      "UPDATE users SET coupon_daily_limit = $2, coupon_monthly_limit = $3 WHERE id = $1",
      [userId, couponDailyLimit, couponMonthlyLimit]
    )
    // El propio usuario recibe el evento (SSE) y refresca su navegación.
    await publishRealtime(client, { kind: "users", entityId: userId })
  })
}
