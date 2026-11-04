"use client"

import type { FilterQuery, FilterRule } from "@/components/reui/filters/filters-types"
import {
  flattenFilterRules,
  isFilterRuleComplete,
} from "@/components/reui/filters/filters-query"

type Accessor<T> = (row: T) => string | number | boolean | null | undefined

/** Número desde el valor crudo del accessor; null si no hay valor numérico. */
function toNumber(
  raw: string | number | boolean | null | undefined
): number | null {
  if (raw === null || raw === undefined || raw === "") return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

/**
 * ¿La fila cumple la regla? El único criterio de operadores del proyecto:
 * lo usa la barra completa (`applyFilterQuery`) y los conteos en cascada de
 * los chips de Clientes, para que nunca diverjan. La negación puede venir
 * como operador inverso o como marca `negated`, y ambos casos se respetan.
 */
export function matchesFilterRule<T>(
  rule: FilterRule,
  row: T,
  accessor: Accessor<T>
): boolean {
  const raw = accessor(row)
  const text =
    raw === null || raw === undefined
      ? ""
      : String(raw).toLocaleLowerCase("es")
  const rawValues = Array.isArray(rule.value)
    ? rule.value
    : rule.value === undefined || rule.value === null
      ? []
      : [rule.value]
  const targets = rawValues.map((value) =>
    String(value).toLocaleLowerCase("es")
  )

  let matches: boolean
  switch (rule.operator) {
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
    case "eq": {
      const num = toNumber(raw)
      matches = num !== null && targets.some((target) => num === Number(target))
      break
    }
    case "neq": {
      const num = toNumber(raw)
      matches = num === null || !targets.some((target) => num === Number(target))
      break
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const num = toNumber(raw)
      const bound = toNumber(targets[0])
      matches =
        num !== null &&
        bound !== null &&
        (rule.operator === "gt"
          ? num > bound
          : rule.operator === "gte"
            ? num >= bound
            : rule.operator === "lt"
              ? num < bound
              : num <= bound)
      break
    }
    case "between":
    case "not_between": {
      const num = toNumber(raw)
      const lo = toNumber(targets[0])
      const hi = toNumber(targets[1])
      const inside =
        num !== null && lo !== null && hi !== null && num >= lo && num <= hi
      matches = rule.operator === "between" ? inside : !inside
      break
    }
    default:
      matches = true
  }

  return rule.negated ? !matches : matches
}

/**
 * Aplica la consulta de filtros sobre las filas ya descargadas.
 *
 * Los filtros del panel funcionan sobre la página cargada, no sobre el
 * servidor: los nombres de parámetro del servicio no están garantizados, así
 * que filtrar en el cliente siempre es correcto.
 */
export function applyFilterQuery<T>(
  rows: T[],
  query: FilterQuery,
  accessors: Record<string, Accessor<T>>
): T[] {
  const rules = flattenFilterRules(query).filter(isFilterRuleComplete)
  if (rules.length === 0) return rows

  return rows.filter((row) =>
    rules.every((rule) => {
      const accessor = accessors[rule.path[0]]
      return accessor ? matchesFilterRule(rule, row, accessor) : true
    })
  )
}
