import { pool, withTransaction } from "@/server/db"
import { publishRealtime } from "@/server/realtime/bus"

import {
  MODULE_PERMISSION_KEYS,
  isModulePermissionKey,
} from "@/lib/modulos"

/**
 * Permisos de módulos por usuario: controla qué tarjetas del hub `/modulos`
 * ve cada cuenta (solo visibilidad del listado; las rutas siguen servidas).
 * Sin filas para un usuario = todos los módulos visibles (valor por defecto).
 * Las cuentas admin siempre ven todo: el hub ignora esta tabla para ellas.
 */

/** Hrefs de módulos ocultos para un usuario (filas `visible = false`). */
export async function getHiddenModules(userId: string): Promise<string[]> {
  const result = await pool.query(
    "SELECT module FROM user_module_permissions WHERE user_id = $1 AND NOT visible",
    [userId]
  )
  return result.rows
    .map((row) => row.module as string)
    .filter((href) => isModulePermissionKey(href))
}

/** Módulos ocultos para cada usuario del listado (para la matriz admin). */
export async function listHiddenModulesByUser(): Promise<
  Map<string, string[]>
> {
  const result = await pool.query(
    `SELECT user_id, array_agg(module) AS hidden
       FROM user_module_permissions
      WHERE NOT visible
      GROUP BY user_id`
  )
  const hidden = new Map<string, string[]>()
  for (const row of result.rows) {
    hidden.set(
      row.user_id as string,
      (row.hidden as string[]).filter((href) => isModulePermissionKey(href))
    )
  }
  return hidden
}

/**
 * Guarda la matriz completa de un usuario: una fila por módulo del catálogo
 * ajustable con su visibilidad. `visibleHrefs` son los hrefs que quedan
 * visibles; todo lo demás del catálogo se marca oculto.
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
