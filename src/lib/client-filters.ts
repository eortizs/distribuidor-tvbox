import type { FilterQuery } from "@/components/reui/filters/filters-types"

/**
 * Filtros compuestos guardados de `/clientes`.
 *
 * Un filtro guardado es un stack plano de reglas (todas se cumplen a la vez,
 * AND) más un modo de agrupación opcional («Agrupar por» socio o estado) y un
 * nombre elegido por el usuario. Viven en su cuenta (tabla
 * `client_saved_filters`) y se aplican sobre el listado ya descargado, igual
 * que la consulta efímera que sustituyeron.
 *
 * Esta librería la comparten cliente y servidor: el servidor valida con
 * `normalizeClientFilterPayload` antes de persistir y el builder del bottom
 * sheet la usa para construir la consulta viva (`buildClientFilterQuery`) y
 * rotular las reglas (`clientFilterRuleText`).
 */

/** Modos de agrupación de un filtro guardado; «socio» es exclusivo de admin. */
export type ClientFilterGroupBy = "ninguno" | "estado" | "socio"

/** Campos filtrables de la pantalla de clientes. */
export type ClientFilterField = "estado" | "reseller" | "dias"

/**
 * Una regla del stack. `value` es el texto tal cual del selector
 * (estado/distribuidor) o el número de días; `null` mientras el operador no
 * requiere valor (`empty`) o el usuario aún no elige.
 */
export interface ClientFilterRule {
  field: ClientFilterField
  operator: string
  value: string | number | null
}

/** Carga útil de un filtro guardado (sin id); es lo que viaja por la API. */
export interface ClientFilterPayload {
  name: string
  groupBy: ClientFilterGroupBy
  rules: ClientFilterRule[]
}

/** Un filtro guardado tal como lo devuelve la API. */
export interface ClientSavedFilter extends ClientFilterPayload {
  id: string
}

/** Tope de reglas por filtro: un stack infinito no se lee ni se edita bien. */
export const CLIENT_FILTER_MAX_RULES = 8

/** Tope del nombre del filtro. */
export const CLIENT_FILTER_NAME_MAX = 60

/** Operadores ofrecidos por campo, con su etiqueta en español. */
export const CLIENT_FILTER_OPERATORS: Record<
  ClientFilterField,
  { value: string; label: string }[]
> = {
  estado: [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
  ],
  reseller: [
    { value: "is", label: "es" },
    { value: "is_not", label: "no es" },
  ],
  dias: [
    { value: "lt", label: "menor que" },
    { value: "lte", label: "menor o igual que" },
    { value: "gt", label: "mayor que" },
    { value: "gte", label: "mayor o igual que" },
    { value: "eq", label: "es igual a" },
    { value: "empty", label: "está vacío (sin dato)" },
  ],
}

/** Etiqueta del campo para leer la regla como una frase: «por estado …». */
export const CLIENT_FILTER_FIELD_LABELS: Record<ClientFilterField, string> = {
  estado: "por estado",
  reseller: "por distribuidor",
  dias: "por días para vencer",
}

/** Valores válidos del campo estado (los del semáforo del panel). */
export const CLIENT_FILTER_ESTADO_VALUES = [
  "activo",
  "vencido",
  "pendiente",
  "prueba",
] as const

/** Etiqueta bonita de un valor de estado. */
export function clientEstadoLabel(value: string): string {
  switch (value) {
    case "activo":
      return "Activo"
    case "vencido":
      return "Vencido"
    case "pendiente":
      return "Pendiente"
    case "prueba":
      return "Prueba"
    default:
      return value
  }
}

/**
 * La regla como texto: «por estado es Activo», «por distribuidor no es
 * eortizs», «por días para vencer menor que 2». Es la píldora de solo
 * lectura del filtro activo y el idioma compartido con el builder.
 */
export function clientFilterRuleText(rule: ClientFilterRule): string {
  const field = CLIENT_FILTER_FIELD_LABELS[rule.field]
  const operator =
    CLIENT_FILTER_OPERATORS[rule.field].find(
      (option) => option.value === rule.operator
    )?.label ?? rule.operator
  if (rule.field === "dias") {
    return rule.operator === "empty" || rule.value === null || rule.value === ""
      ? `${field} ${operator}`
      : `${field} ${operator} ${rule.value}`
  }
  const value =
    rule.field === "estado"
      ? clientEstadoLabel(String(rule.value ?? ""))
      : String(rule.value ?? "") || "sin distribuidor"
  return `${field} ${operator} ${value}`
}

/**
 * El stack de reglas como consulta del motor de filtros (grupo raíz AND, ids
 * deterministas): se ejecuta con `applyFilterQuery` sobre el listado cargado.
 */
export function buildClientFilterQuery(rules: ClientFilterRule[]): FilterQuery {
  return {
    id: "root",
    type: "group",
    combinator: "and",
    rules: rules.map((rule, index) => ({
      id: `rule-${index + 1}`,
      type: "rule" as const,
      path: [rule.field],
      operator: rule.operator,
      value: rule.value ?? undefined,
    })),
  }
}

/** ¿La regla dice algo? Operador elegido y valor presente (salvo `empty`). */
export function isClientFilterRuleComplete(rule: ClientFilterRule): boolean {
  if (!rule.operator) return false
  if (rule.operator === "empty") return true
  // En distribuidor la cadena vacía ES un valor: «Sin distribuidor».
  if (rule.field === "reseller") return typeof rule.value === "string"
  return rule.value !== null && rule.value !== ""
}

/**
 * Normaliza y valida la carga útil. Devuelve el payload saneado (nombre con
 * trim, reglas con valores de días como número) o el motivo del rechazo; no
 * lanza: la ruta lo convierte en 422 y el builder usa el mismo criterio para
 * habilitar «Guardar filtro».
 *
 * `isAdmin` decide qué campos y modos de agrupación admite: «socio» y el
 * campo distribuidor son de admin (bajo alcance de distribuidor todas las
 * filas comparten socio, así que no filtran nada).
 */
export function normalizeClientFilterPayload(
  input: unknown,
  options: { isAdmin: boolean }
):
  | { ok: true; value: ClientFilterPayload }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Se esperaba un objeto de filtro." }
  }
  const raw = input as {
    name?: unknown
    groupBy?: unknown
    rules?: unknown
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  if (name.length < 1) {
    return { ok: false, error: "El filtro necesita un nombre." }
  }
  if (name.length > CLIENT_FILTER_NAME_MAX) {
    return {
      ok: false,
      error: `El nombre no puede pasar de ${CLIENT_FILTER_NAME_MAX} caracteres.`,
    }
  }

  let groupBy: ClientFilterGroupBy = "ninguno"
  if (raw.groupBy === "estado" || raw.groupBy === "socio") {
    groupBy = raw.groupBy
  } else if (raw.groupBy !== undefined && raw.groupBy !== "ninguno" && raw.groupBy !== null) {
    return { ok: false, error: "Modo de agrupación inválido." }
  }
  if (groupBy === "socio" && !options.isAdmin) {
    return {
      ok: false,
      error: "Agrupar por socio solo está disponible para administradores.",
    }
  }

  if (!Array.isArray(raw.rules)) {
    return { ok: false, error: "Se esperaba una lista de reglas." }
  }
  if (raw.rules.length > CLIENT_FILTER_MAX_RULES) {
    return {
      ok: false,
      error: `Máximo ${CLIENT_FILTER_MAX_RULES} reglas por filtro.`,
    }
  }

  const rules: ClientFilterRule[] = []
  for (const entry of raw.rules) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "Regla inválida." }
    }
    const rule = entry as {
      field?: unknown
      operator?: unknown
      value?: unknown
    }

    if (
      rule.field !== "estado" &&
      rule.field !== "reseller" &&
      rule.field !== "dias"
    ) {
      return { ok: false, error: "Campo de regla inválido." }
    }
    const field = rule.field
    if (field === "reseller" && !options.isAdmin) {
      return {
        ok: false,
        error: "El campo distribuidor solo está disponible para administradores.",
      }
    }

    const allowed = CLIENT_FILTER_OPERATORS[field].map((op) => op.value)
    if (typeof rule.operator !== "string" || !allowed.includes(rule.operator)) {
      return { ok: false, error: "Operador inválido para el campo elegido." }
    }

    if (field === "dias") {
      if (rule.operator === "empty") {
        rules.push({ field, operator: rule.operator, value: null })
        continue
      }
      const num = typeof rule.value === "number"
        ? rule.value
        : typeof rule.value === "string" && rule.value.trim() !== ""
          ? Number(rule.value)
          : NaN
      if (!Number.isFinite(num)) {
        return { ok: false, error: "Los días para vencer deben ser un número." }
      }
      rules.push({ field, operator: rule.operator, value: num })
      continue
    }

    const rawValue: unknown = rule.value
    let value: string | number
    if (typeof rawValue === "string") {
      value = rawValue.trim()
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      value = rawValue
    } else {
      return { ok: false, error: "La regla necesita un valor." }
    }
    if (field === "estado") {
      if (
        typeof value !== "string" ||
        !CLIENT_FILTER_ESTADO_VALUES.includes(value as never)
      ) {
        return { ok: false, error: "Valor de estado inválido." }
      }
    }
    if (typeof value === "string" && value.length > 80) {
      return { ok: false, error: "Valor de regla demasiado largo." }
    }
    // En distribuidor la cadena vacía viaja tal cual: significa
    // «Sin distribuidor» (los clientes propios del admin).
    rules.push({ field, operator: rule.operator, value })
  }

  if (rules.length === 0 && groupBy === "ninguno") {
    return {
      ok: false,
      error: "Agrega al menos una regla o elige un modo de agrupación.",
    }
  }

  return { ok: true, value: { name, groupBy, rules } }
}
