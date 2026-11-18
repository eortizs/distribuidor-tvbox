/**
 * Dominio puro del módulo Notas (/modulos/notas): tipos compartidos por
 * servidor y cliente, límites (espejo del CHECK de db/notas-schema.sql),
 * validación de la forma de una nota y derivación del título. Sin BD ni
 * React: se puede probar con node directo (scripts/test-notas.mjs).
 */

/** Máximo de caracteres del título (después de recortar espacios). */
export const NOTA_TITLE_MAX = 120

/** Máximo de caracteres del texto de la nota. */
export const NOTA_BODY_MAX = 20000

/** Tope de notas por usuario (lo aplica el repositorio en transacción). */
export const NOTAS_MAX_POR_USUARIO = 200

/** Caracteres del texto incluidos en el listado (el cuerpo completo solo
 * viaja al editar la nota). */
export const NOTA_PREVIEW_CHARS = 200

/** Mínimo de caracteres para disparar la búsqueda al servidor. */
export const NOTAS_BUSQUEDA_MIN = 2

/** Nota completa: la forma que devuelve el servidor al crear/editar/leer. */
export interface Nota {
  id: string
  title: string
  body: string
  pinned: boolean
  version: number
  createdAt: string
  updatedAt: string
}

/** Renglón del listado: cuerpo truncado y sin `version` ni `createdAt`. */
export interface NotaPreview {
  id: string
  title: string
  body: string
  pinned: boolean
  updatedAt: string
}

/** Entrada de creación/edición ya sanitizada. */
export interface NotaInput {
  title: string
  body: string
  pinned: boolean
}

export type ValidacionNota =
  | { ok: true; nota: NotaInput }
  | { ok: false; code: string; error: string }

const NOTA_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un id con forma de uuid evita que llegue al caster de Postgres. */
export function esNotaIdValido(id: unknown): id is string {
  return typeof id === "string" && NOTA_ID_RE.test(id)
}

/**
 * Título efectivo de la nota: el escrito por el usuario, o la primera línea
 * del texto recortada al tope cuando llega vacío. Si no hay nada que
 * mostrar devuelve cadena vacía (la nota es inválida).
 */
export function deriveTitle(title: string, body: string): string {
  const escrito = title.trim()
  if (escrito) return escrito.slice(0, NOTA_TITLE_MAX)
  const primeraLinea = body.trimStart().split(/\r?\n/, 1)[0] ?? ""
  return primeraLinea.trim().slice(0, NOTA_TITLE_MAX)
}

/** Texto truncado para el listado (sin elipsis: el estilo la agrega). */
export function previewBody(body: string): string {
  return body.slice(0, NOTA_PREVIEW_CHARS)
}

/**
 * Sanitiza y valida la entrada de crear/editar una nota. Reemplazo total:
 * title/body/pinned siempre quedan como envía el cliente (para el toggle de
 * fijar se reenvía el contenido actual). Errores legibles en español.
 */
export function validarNotaInput(raw: unknown): ValidacionNota {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Solicitud inválida: se esperaba { title?, body?, pinned? }.",
    }
  }
  const data = raw as Record<string, unknown>
  const title = typeof data.title === "string" ? data.title.trim() : ""
  const body = typeof data.body === "string" ? data.body : ""
  if (title.length > NOTA_TITLE_MAX) {
    return {
      ok: false,
      code: "nota_invalida",
      error: `El título no puede pasar de ${NOTA_TITLE_MAX} caracteres.`,
    }
  }
  if (body.length > NOTA_BODY_MAX) {
    return {
      ok: false,
      code: "nota_invalida",
      error: `El texto no puede pasar de ${NOTA_BODY_MAX} caracteres.`,
    }
  }
  if (!deriveTitle(title, body)) {
    return {
      ok: false,
      code: "nota_vacia",
      error: "La nota está vacía: escribe un título o al menos una línea.",
    }
  }
  return {
    ok: true,
    nota: {
      // El título efectivo se persiste: si llegó vacío queda la primera
      // línea del texto, así el listado siempre muestra título y la
      // búsqueda por título también encuentra esa línea.
      title: deriveTitle(title, body),
      body,
      pinned: data.pinned === true,
    },
  }
}

/** Versión esperada del compare-and-swap por nota. */
export function validarVersion(raw: unknown): number | null {
  const version = Number(raw)
  return Number.isInteger(version) && version > 0 ? version : null
}

/** Row cruda de Postgres (snake_case, fechas Date) → Nota para la API. */
export function notaDeRow(row: Record<string, unknown>): Nota {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    pinned: row.pinned === true,
    version: Number(row.version) || 1,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? ""),
  }
}

/** Row cruda → renglón del listado con el cuerpo truncado. */
export function previewDeRow(row: Record<string, unknown>): NotaPreview {
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    body: previewBody(typeof row.body === "string" ? row.body : ""),
    pinned: row.pinned === true,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? ""),
  }
}

/** Escapa los comodines de ILIKE para buscar el texto literal. */
export function patronBusqueda(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}
