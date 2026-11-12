import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"
import {
  normalizeClientFilterPayload,
  type ClientSavedFilter,
} from "@/lib/client-filters"

/**
 * Filtros compuestos guardados de `/clientes`, por usuario (tabla
 * `client_saved_filters`). El nombre es único por cuenta y la carga útil se
 * valida con la lib compartida antes de persistir; al leer se re-valida y
 * las filas que ya no pasan (p. ej. reglas de distribuidor tras bajar de
 * rol) se omiten en silencio: nunca rompen la pantalla.
 */

interface FilterRow {
  id: string
  name: string
  group_by: string
  rules: unknown
}

function rowToFilter(row: FilterRow, isAdmin: boolean): ClientSavedFilter | null {
  const normalized = normalizeClientFilterPayload(
    {
      name: row.name,
      groupBy: row.group_by,
      rules: Array.isArray(row.rules) ? row.rules : [],
    },
    { isAdmin }
  )
  if (!normalized.ok) return null
  return { id: row.id, ...normalized.value }
}

export async function listSavedClientFilters(
  userId: string,
  isAdmin: boolean
): Promise<ClientSavedFilter[]> {
  const result = await pool.query(
    `SELECT id, name, group_by, rules
       FROM client_saved_filters
      WHERE user_id = $1
      ORDER BY created_at ASC, name ASC`,
    [userId]
  )
  const filters: ClientSavedFilter[] = []
  for (const row of result.rows as FilterRow[]) {
    const filter = rowToFilter(row, isAdmin)
    if (filter) filters.push(filter)
  }
  return filters
}

export async function createSavedClientFilter(
  userId: string,
  isAdmin: boolean,
  input: unknown
): Promise<ClientSavedFilter> {
  const normalized = normalizeClientFilterPayload(input, { isAdmin })
  if (!normalized.ok) {
    throw new AppError(422, "invalid_filter", normalized.error)
  }

  let created: FilterRow
  try {
    const result = await pool.query(
      `INSERT INTO client_saved_filters (user_id, name, group_by, rules)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, name, group_by, rules`,
      [
        userId,
        normalized.value.name,
        normalized.value.groupBy,
        JSON.stringify(normalized.value.rules),
      ]
    )
    created = result.rows[0] as FilterRow
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AppError(
        409,
        "duplicate_name",
        "Ya tienes un filtro con ese nombre."
      )
    }
    throw error
  }

  return {
    id: created.id,
    name: normalized.value.name,
    groupBy: normalized.value.groupBy,
    rules: normalized.value.rules,
  }
}

export async function updateSavedClientFilter(
  userId: string,
  isAdmin: boolean,
  filterId: string,
  input: unknown
): Promise<ClientSavedFilter | null> {
  const normalized = normalizeClientFilterPayload(input, { isAdmin })
  if (!normalized.ok) {
    throw new AppError(422, "invalid_filter", normalized.error)
  }

  let updated: FilterRow
  try {
    const result = await pool.query(
      `UPDATE client_saved_filters
          SET name = $3, group_by = $4, rules = $5::jsonb
        WHERE id = $1 AND user_id = $2
        RETURNING id, name, group_by, rules`,
      [
        filterId,
        userId,
        normalized.value.name,
        normalized.value.groupBy,
        JSON.stringify(normalized.value.rules),
      ]
    )
    if (result.rowCount === 0) return null
    updated = result.rows[0] as FilterRow
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AppError(
        409,
        "duplicate_name",
        "Ya tienes un filtro con ese nombre."
      )
    }
    throw error
  }

  return {
    id: updated.id,
    name: normalized.value.name,
    groupBy: normalized.value.groupBy,
    rules: normalized.value.rules,
  }
}

export async function deleteSavedClientFilter(
  userId: string,
  filterId: string
): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM client_saved_filters WHERE id = $1 AND user_id = $2",
    [filterId, userId]
  )
  return (result.rowCount ?? 0) > 0
}
