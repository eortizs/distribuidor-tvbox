import { pool, withTransaction } from "@/server/db"
import { publishRealtime } from "@/server/realtime/bus"

import {
  MODULE_PERMISSION_KEYS,
  MODULES_DEFAULT_VISIBLE_HREFS,
  isModulePermissionKey,
} from "@/lib/modulos"

/**
 * Permisos de módulos por usuario: controla qué tarjetas del hub `/modulos`
 * ve cada cuenta (solo visibilidad del listado; las rutas siguen servidas).
 *
 * Regla (idéntica en el hub y en los sheets admin):
 * - fila `visible = false` → oculto; fila `visible = true` → visible.
 * - SIN fila: los hrefs de `MODULES_DEFAULT_VISIBLE_HREFS` (catálogo previo
 *   al cambio de default) siguen visibles; todo módulo agregado DESPUÉS a
 *   `MODULOS` nace OCULTO para la cuenta hasta que el admin lo haga visible
 *   desde el sheet «Módulos». Así un módulo nuevo jamás se enciende solo.
 *
 * Las cuentas admin siempre ven todo: el hub ignora esta tabla para ellas.
 */

interface ModulePermissionRow {
  module: unknown
  visible: unknown
}

/**
 * Hrefs ocultos dadas las filas crudas de una cuenta: lo marcado oculto más
 * todo módulo ajustable sin fila que no pertenezca al default visible
 * histórico (`MODULES_DEFAULT_VISIBLE_HREFS`).
 */
function computeHiddenModules(rows: ModulePermissionRow[]): string[] {
  const visible = new Set<string>()
  const hidden = new Set<string>()
  for (const row of rows) {
    const href = row.module
    if (typeof href !== "string" || !isModulePermissionKey(href)) continue
    ;(row.visible ? visible : hidden).add(href)
  }
  return MODULE_PERMISSION_KEYS.filter(
    (href) =>
      hidden.has(href) ||
      (!visible.has(href) && !MODULES_DEFAULT_VISIBLE_HREFS.has(href))
  )
}

/** Hrefs de módulos ocultos para un usuario. */
export async function getHiddenModules(userId: string): Promise<string[]> {
  const result = await pool.query(
    "SELECT module, visible FROM user_module_permissions WHERE user_id = $1",
    [userId]
  )
  return computeHiddenModules(result.rows)
}

/** Módulos ocultos para cada usuario del listado (para la matriz admin). */
export async function listHiddenModulesByUser(): Promise<
  Map<string, string[]>
> {
  const result = await pool.query(
    `SELECT u.id AS user_id, p.module, p.visible
       FROM users u
       LEFT JOIN user_module_permissions p ON p.user_id = u.id`
  )
  const rowsByUser = new Map<string, ModulePermissionRow[]>()
  for (const row of result.rows) {
    const userId = row.user_id as string
    const list = rowsByUser.get(userId) ?? []
    if (row.module !== null) list.push(row as ModulePermissionRow)
    rowsByUser.set(userId, list)
  }
  const hidden = new Map<string, string[]>()
  for (const [userId, rows] of rowsByUser) {
    hidden.set(userId, computeHiddenModules(rows))
  }
  return hidden
}

/**
 * Guarda la matriz completa de un usuario: una fila por módulo del catálogo
 * ajustable con su visibilidad. `visibleHrefs` son los hrefs que quedan
 * visibles; todo lo demás del catálogo se marca oculto. Tras un guardado la
 * cuenta tiene fila explícita para todo el catálogo, así que el default
 * «nuevo módulo = oculto» deja de aplicarle: los módulos que aparezcan
 * DESPUÉS del guardado sí nacen ocultos hasta que el admin los active.
 */
export async function setModuleVisibility(
  userId: string,
  visibleHrefs: string[]
): Promise<void> {
  const unique = [...new Set(visibleHrefs)]
  if (unique.some((href) => !isModulePermissionKey(href))) {
    throw new Error("Unknown module href")
  }
  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM user_module_permissions WHERE user_id = $1",
      [userId]
    )
    for (const href of MODULE_PERMISSION_KEYS) {
      await client.query(
        `INSERT INTO user_module_permissions (user_id, module, visible)
         VALUES ($1, $2, $3)`,
        [userId, href, unique.includes(href)]
      )
    }
    // El propio usuario recibe el evento (SSE) y refresca su hub de módulos.
    await publishRealtime(client, { kind: "users", entityId: userId })
  })
}
