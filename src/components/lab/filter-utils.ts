"use client"

import type { FilterQuery } from "@/components/reui/filters/filters-types"
import { flattenFilterConditions } from "@/components/reui/filters/filters-query"

type Accessor<T> = (row: T) => string | number | boolean | null | undefined

/**
 * Aplica la consulta de filtros sobre las filas ya descargadas.
 *
 * Los filtros del panel works sobre la página cargada, no sobre el servidor:
 * los nombres de parámetro del servicio no están garantizados, así que filtrar
 * en el cliente siempre es correcto. El negate puede venir como operador
 * inverso o como marca `negated`, y ambos casos se respetan.
 */
export function applyFilterQuery<T>(
  rows: T[],
  query: FilterQuery,
  accessors: Record<string, Accessor<T>>
): T[] {
  const conditions = flattenFilterConditions(query)
  if (conditions.length === 0) return rows

  return rows.filter((row) =>
    conditions.every((condition) => {
      const accessor = accessors[condition.field]
      if (!accessor) return true

      const raw = accessor(row)
      const text =
        raw === null || raw === undefined ? "" : String(raw).toLocaleLowerCase("es")
      const targets = condition.values.map((value) =>
        String(value).toLocaleLowerCase("es")
      )

      let matches: boolean
      switch (condition.operator) {
        case "contains":
          matches = targets.some((target) => text.includes(target))
          break
        case "not_contains":
          matches = !targets.some((target) => text.includes(target))
          break
        case "starts_with":
          matches = targets.some((target) => text.startsWith(target))
          break
        case "ends_with":
          matches = targets.some((target) => text.endsWith(target))
          break
        case "is":
        case "is_any_of":
          matches = targets.includes(text)
          break
        case "is_not":
        case "is_none_of":
          matches = !targets.includes(text)
          break
        case "empty":
          matches = text.length === 0
          break
        case "not_empty":
          matches = text.length > 0
          break
        default:
          matches = true
      }

      return condition.negated ? !matches : matches
    })
  )
}
