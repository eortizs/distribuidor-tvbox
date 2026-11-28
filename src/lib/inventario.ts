/**
 * Dominio puro del módulo Inventario (/modulos/inventario): tipos
 * compartidos por servidor y cliente, límites (espejo de los CHECK de
 * db/inventario-schema.sql), lista fija de condiciones (nuevo/usado/dañado),
 * validación de lotes y movimientos, parser de cantidades tolerante (hasta
 * 3 decimales, rechaza formas ambiguas) y utilidades de caducidad por día
 * calendario en America/Mexico_City. Sin BD ni React: se puede probar con
 * node directo (scripts/test-inventario.mjs).
 */

// Import relativo CON extensión: los tests corren con Node directo
// (node scripts/test-inventario.mjs), que no resuelve el alias "@/...".
import { esArticuloIdValido } from "./articulos.ts"

/** Máximo de caracteres del código de lote. */
export const INVENTARIO_LOTE_MAX = 60

/** Máximo de caracteres de la ubicación. */
export const INVENTARIO_UBICACION_MAX = 120

/** Máximo de caracteres del motivo de un movimiento. */
export const INVENTARIO_MOTIVO_MAX = 200

/**
 * Tope de cantidad por lote (espejo del CHECK numeric(12,3), cuyo máximo
 * físico es 999 999 999.999 — 9 dígitos enteros + 3 decimales): el valor
 * exacto 1e9 DESBORDARÍA la columna (22003) aunque un CHECK `<= 1e9`
 * existiera, así que el tope efectivo es el máximo de la columna.
 */
export const INVENTARIO_CANTIDAD_MAX = 999_999_999.999

/**
 * Tope de lotes por tenant (lo aplica el repositorio en transacción): con
 * 5 000 artículos del catálogo deja margen para ~4 lotes por artículo.
 */
export const INVENTARIO_MAX_LOTES_POR_TENANT = 20_000

/**
 * Días de anticipación para considerar un lote «por vencer» (inclusive: un
 * lote que vence hoy cuenta como por vencer, no como vencido).
 */
export const INVENTARIO_DIAS_POR_VENCER = 30

/**
 * Condiciones fijas de un lote. Lo vencido lo cubre la caducidad, no la
 * condición: esta describe el ESTADO FÍSICO/COMERCIAL del bien.
 */
export const CONDICIONES = [
  { code: "nuevo", label: "Nuevo" },
  { code: "usado", label: "Usado" },
  { code: "danado", label: "Dañado" },
] as const

export type Condicion = (typeof CONDICIONES)[number]["code"]

const CONDICION_POR_CODIGO = new Map<string, Condicion>(
  CONDICIONES.map((opcion) => [opcion.code, opcion.code as Condicion])
)

/** Etiqueta visible de una condición (por código). */
export function condicionEtiqueta(condicion: string): string {
  return CONDICIONES.find((opcion) => opcion.code === condicion)?.label ?? condicion
}

/** Valida la condición: código de la lista fija; default «nuevo». */
export function parsearCondicion(raw: unknown): Condicion {
  if (typeof raw !== "string") return "nuevo"
  return CONDICION_POR_CODIGO.get(raw.trim()) ?? "nuevo"
}

export type KindMovimiento = "entrada" | "salida" | "ajuste"

const KINDS: KindMovimiento[] = ["entrada", "salida", "ajuste"]

/** Etiqueta visible de un tipo de movimiento. */
export function kindEtiqueta(kind: string): string {
  return kind === "entrada"
    ? "Entrada"
    : kind === "salida"
      ? "Salida"
      : "Ajuste"
}

const KIND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un id con forma de uuid evita que llegue al caster de Postgres. */
export function esUuidValido(id: unknown): id is string {
  return typeof id === "string" && KIND_ID_RE.test(id)
}

/* ------------------------------ cantidades ------------------------------- */

/**
 * Cantidad legible a número con hasta 3 decimales, o null si no se entiende
 * con certeza. Acepta «12», «12.5», «12,50», «1,234.5», «1.234,5»,
 * «0,500» y «0.500»; rechaza las formas ambiguas («12.345» podría ser 12.345
 * o doce mil — convención de `parsearPrecio` y `leerImporteDeComprobante`),
 * que el usuario escribe sin ambigüedad como «12,345» (miles) o «12,345 kg»
 * con coma decimal — en cuyo caso gana la lectura de MILES, igual que
 * «1,234» en el catálogo.
 */
export function parsearCantidad(raw: unknown): number | null {
  let cuerpo: string
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null
    cuerpo = String(raw)
  } else if (typeof raw === "string") {
    cuerpo = raw.replace(/[$\s\u00a0\u202f]/g, "")
  } else {
    return null
  }
  if (!cuerpo) return null

  const tieneComa = cuerpo.includes(",")
  const tienePunto = cuerpo.includes(".")
  let canon: string
  if (tieneComa && tienePunto) {
    // El último separador es el decimal; el otro, miles.
    const decimal = cuerpo.lastIndexOf(",") > cuerpo.lastIndexOf(".") ? "," : "."
    const miles = decimal === "," ? "." : ","
    canon = cuerpo.split(miles).join("").replace(decimal, ".")
  } else if (tieneComa) {
    if (/^[1-9]\d{0,2}(,\d{3})+$/.test(cuerpo)) {
      canon = cuerpo.split(",").join("") // miles: 1,234 (y 12,345 → 12345)
    } else if (/^\d+,\d{1,3}$/.test(cuerpo)) {
      canon = cuerpo.replace(",", ".") // decimal: 12,5 y 0,500
    } else {
      return null // ambiguo o con más de 3 decimales
    }
  } else if (tienePunto) {
    if (/^\d+\.\d{1,2}$/.test(cuerpo)) {
      canon = cuerpo // decimal corto: 12.5
    } else if (/^0\.\d{1,3}$/.test(cuerpo)) {
      canon = cuerpo // con cero inicial jamás es miles: 0.500 → 0.5
    } else {
      return null // 12.345, 1.234.567: ambiguo o inválido
    }
  } else {
    canon = cuerpo // entero: 12
  }
  if (!/^\d+(?:\.\d{1,3})?$/.test(canon)) return null
  const parsed = Number(canon)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 1000) / 1000
}

/** Formatea una cantidad para mostrar: sin ceros finales, hasta 3 decimales. */
export function formatearCantidad(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(n)
}

/** Formatea un delta de movimiento con signo explícito para el kardex. */
export function formatearDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${formatearCantidad(delta)}`
}

/* ------------------------------- caducidad ------------------------------- */

const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Fecha ISO «YYYY-MM-DD» real (mes 1-12, día válido del mes) o null.
 * Se guarda como DATE en Postgres y viaja SIEMPRE como string YYYY-MM-DD
 * (el SELECT la emite con to_char): ninguna zona horaria en el camino.
 */
export function parsearFechaIso(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const texto = raw.trim()
  if (!FECHA_ISO_RE.test(texto)) return null
  const [y, m, d] = texto.split("-").map(Number)
  const fecha = new Date(Date.UTC(y, m - 1, d))
  if (
    fecha.getUTCFullYear() !== y ||
    fecha.getUTCMonth() !== m - 1 ||
    fecha.getUTCDate() !== d
  ) {
    return null
  }
  if (y < 2000 || y > 9999) return null
  return texto
}

/** Hoy como «YYYY-MM-DD» en America/Mexico_City (determinista servidor/cliente). */
export function hoyIsoCdmx(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(new Date())
}

/** Días calendario entre dos fechas ISO (positivo = aún falta). */
export function diasParaVencer(caducidadIso: string, hoyIso: string): number {
  const cad = Date.parse(`${caducidadIso}T00:00:00Z`)
  const hoy = Date.parse(`${hoyIso}T00:00:00Z`)
  if (Number.isNaN(cad) || Number.isNaN(hoy)) return 0
  return Math.round((cad - hoy) / 86_400_000)
}

export type EstadoCaducidad = "vencido" | "por_vencer" | "ok"

/**
 * Estado de un lote respecto a HOY en CDMX: vencido (fecha pasada),
 * por_vencer (faltan ≤ 30 días, incluye «vence hoy») u ok.
 */
export function estadoCaducidad(
  caducidadIso: string,
  hoyIso: string
): EstadoCaducidad {
  const dias = diasParaVencer(caducidadIso, hoyIso)
  if (dias < 0) return "vencido"
  if (dias <= INVENTARIO_DIAS_POR_VENCER) return "por_vencer"
  return "ok"
}

const FECHA_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Mexico_City",
})

/** «12 mar 2026» determinista en CDMX desde YYYY-MM-DD. */
export function formatearFecha(iso: string): string {
  const fecha = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(fecha.getTime()) ? "—" : FECHA_FMT.format(fecha)
}

const FECHA_HORA_FMT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Mexico_City",
})

/** «12 mar, 14:05» determinista en CDMX desde un instante ISO. */
export function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? "—" : FECHA_HORA_FMT.format(fecha)
}

/* --------------------------------- tipos --------------------------------- */

/** Lote con los datos del artículo incrustados (forma de los listados). */
export interface LoteInventario {
  id: string
  articuloId: string
  sku: string
  nombre: string
  um: string
  lote: string | null
  caducidad: string | null
  condicion: Condicion
  ubicacion: string | null
  cantidad: number
  version: number
  createdAt: string
  updatedAt: string
}

/** Movimiento del kardex con el contexto del lote/artículo para listados. */
export interface MovimientoInventario {
  id: string
  loteId: string
  articuloId: string
  sku: string
  nombre: string
  lote: string | null
  kind: KindMovimiento
  delta: number
  cantidadAntes: number
  cantidadDespues: number
  motivo: string | null
  createdAt: string
}

/** Cifras del tenant para el resumen del encabezado (día actual de CDMX). */
export interface ResumenInventario {
  articulosConStock: number
  unidadesTotales: number
  lotesPorVencer: number
  lotesVencidos: number
  unidadesDanadas: number
}

/** Entrada de creación de lote ya sanitizada. */
export interface LoteInput {
  articuloId: string
  lote: string | null
  caducidad: string | null
  condicion: Condicion
  ubicacion: string | null
  cantidadInicial: number
}

export type ValidacionLote =
  | { ok: true; lote: LoteInput }
  | { ok: false; code: string; campo?: string; error: string }

/**
 * Sanitiza y valida la entrada de ALTA de un lote. La cantidad inicial es
 * opcional (default 0): un lote en cero permite preparar la ficha y
 * abastecerlo después con una entrada.
 */
export function validarLoteInput(raw: unknown): ValidacionLote {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "invalid_request",
      error:
        "Solicitud inválida: se esperaba { articuloId, condicion, cantidadInicial, ... }.",
    }
  }
  const data = raw as Record<string, unknown>

  const articuloId = data.articuloId
  if (!esArticuloIdValido(articuloId)) {
    return {
      ok: false,
      code: "articulo_invalido",
      campo: "articuloId",
      error: "Elige el artículo del catálogo para este lote.",
    }
  }

  let lote: string | null = null
  if (typeof data.lote === "string") {
    const texto = data.lote.trim()
    if (texto) {
      if (texto.length > INVENTARIO_LOTE_MAX) {
        return {
          ok: false,
          code: "lote_invalido",
          campo: "lote",
          error: `El código de lote no puede pasar de ${INVENTARIO_LOTE_MAX} caracteres.`,
        }
      }
      lote = texto
    }
  } else if (data.lote !== undefined && data.lote !== null) {
    return {
      ok: false,
      code: "lote_invalido",
      campo: "lote",
      error: "El código de lote debe ser texto.",
    }
  }

  let caducidad: string | null = null
  if (
    data.caducidad !== undefined &&
    data.caducidad !== null &&
    data.caducidad !== ""
  ) {
    const fecha = parsearFechaIso(data.caducidad)
    if (!fecha) {
      return {
        ok: false,
        code: "caducidad_invalida",
        campo: "caducidad",
        error: "La caducidad debe ser una fecha válida (AAAA-MM-DD).",
      }
    }
    caducidad = fecha
  }

  const condicion = parsearCondicion(data.condicion)

  let ubicacion: string | null = null
  if (typeof data.ubicacion === "string") {
    const texto = data.ubicacion.trim()
    if (texto) {
      if (texto.length > INVENTARIO_UBICACION_MAX) {
        return {
          ok: false,
          code: "ubicacion_invalida",
          campo: "ubicacion",
          error: `La ubicación no puede pasar de ${INVENTARIO_UBICACION_MAX} caracteres.`,
        }
      }
      ubicacion = texto
    }
  } else if (data.ubicacion !== undefined && data.ubicacion !== null) {
    return {
      ok: false,
      code: "ubicacion_invalida",
      campo: "ubicacion",
      error: "La ubicación debe ser texto.",
    }
  }

  let cantidadInicial = 0
  if (
    data.cantidadInicial !== undefined &&
    data.cantidadInicial !== null &&
    data.cantidadInicial !== ""
  ) {
    const cantidad = parsearCantidad(data.cantidadInicial)
    if (cantidad === null) {
      return {
        ok: false,
        code: "cantidad_invalida",
        campo: "cantidadInicial",
        error:
          "La cantidad inicial debe ser un número válido con hasta 3 decimales.",
      }
    }
    if (cantidad > INVENTARIO_CANTIDAD_MAX) {
      return {
        ok: false,
        code: "cantidad_invalida",
        campo: "cantidadInicial",
        error: `La cantidad no puede pasar de ${formatearCantidad(
          INVENTARIO_CANTIDAD_MAX
        )}.`,
      }
    }
    cantidadInicial = cantidad
  }

  return {
    ok: true,
    lote: {
      articuloId,
      lote,
      caducidad,
      condicion,
      ubicacion,
      cantidadInicial,
    },
  }
}

/** Entrada de edición de metadatos de lote ya sanitizada (sin cantidad). */
export interface LoteMetaInput {
  lote: string | null
  caducidad: string | null
  condicion: Condicion
  ubicacion: string | null
}

export type ValidacionLoteMeta =
  | { ok: true; meta: LoteMetaInput }
  | { ok: false; code: string; campo?: string; error: string }

/**
 * Reemplazo completo de los metadatos del lote (lote/caducidad/condición/
 * ubicación). La CANTIDAD no se toca aquí: solo cambia por movimientos.
 */
export function validarLoteMetaInput(raw: unknown): ValidacionLoteMeta {
  const base = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  const alta = validarLoteInput({
    ...base,
    // El PATCH de metadatos no incluye articuloId ni cantidad: un uuid
    // canónico pasa la validación compartida y se descarta abajo.
    articuloId: "00000000-0000-4000-8000-000000000000",
    cantidadInicial: 0,
  })
  if (!alta.ok) return alta
  return {
    ok: true,
    meta: {
      lote: alta.lote.lote,
      caducidad: alta.lote.caducidad,
      condicion: alta.lote.condicion,
      ubicacion: alta.lote.ubicacion,
    },
  }
}

/** Entrada de movimiento ya interpretada (el delta lo calcula el repositorio). */
export interface MovimientoInput {
  kind: KindMovimiento
  /** Entrada/salida: magnitud positiva. */
  cantidad?: number
  /** Ajuste: conteo físico (objetivo absoluto). */
  cantidadObjetivo?: number
  motivo: string | null
}

export type ValidacionMovimiento =
  | { ok: true; movimiento: MovimientoInput }
  | { ok: false; code: string; campo?: string; error: string }

/**
 * Sanitiza y valida un movimiento: entrada/salida piden magnitud positiva;
 * ajuste pide el CONTEO FÍSICO (a cuánto queda el lote) — el servidor
 * calcula el delta y rechaza el ajuste que no cambia nada.
 */
export function validarMovimientoInput(raw: unknown): ValidacionMovimiento {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "invalid_request",
      error:
        "Solicitud inválida: se esperaba { kind, cantidad | cantidadObjetivo, motivo? }.",
    }
  }
  const data = raw as Record<string, unknown>

  const kind = data.kind
  if (typeof kind !== "string" || !KINDS.includes(kind as KindMovimiento)) {
    return {
      ok: false,
      code: "kind_invalido",
      campo: "kind",
      error: "El tipo de movimiento debe ser entrada, salida o ajuste.",
    }
  }

  let motivo: string | null = null
  if (typeof data.motivo === "string") {
    const texto = data.motivo.trim()
    if (texto) {
      if (texto.length > INVENTARIO_MOTIVO_MAX) {
        return {
          ok: false,
          code: "motivo_invalido",
          campo: "motivo",
          error: `El motivo no puede pasar de ${INVENTARIO_MOTIVO_MAX} caracteres.`,
        }
      }
      motivo = texto
    }
  } else if (data.motivo !== undefined && data.motivo !== null) {
    return {
      ok: false,
      code: "motivo_invalido",
      campo: "motivo",
      error: "El motivo debe ser texto.",
    }
  }

  if (kind === "ajuste") {
    const objetivo = parsearCantidad(data.cantidadObjetivo)
    if (objetivo === null) {
      return {
        ok: false,
        code: "cantidad_invalida",
        campo: "cantidadObjetivo",
        error:
          "Escribe el conteo físico: a cuánto queda el lote después del ajuste.",
      }
    }
    if (objetivo > INVENTARIO_CANTIDAD_MAX) {
      return {
        ok: false,
        code: "cantidad_invalida",
        campo: "cantidadObjetivo",
        error: `La cantidad no puede pasar de ${formatearCantidad(
          INVENTARIO_CANTIDAD_MAX
        )}.`,
      }
    }
    return {
      ok: true,
      movimiento: { kind: "ajuste", cantidadObjetivo: objetivo, motivo },
    }
  }

  const cantidad = parsearCantidad(data.cantidad)
  if (cantidad === null || cantidad <= 0) {
    return {
      ok: false,
      code: "cantidad_invalida",
      campo: "cantidad",
      error:
        kind === "entrada"
          ? "La cantidad de entrada debe ser mayor a cero."
          : "La cantidad de salida debe ser mayor a cero.",
    }
  }
  if (cantidad > INVENTARIO_CANTIDAD_MAX) {
    return {
      ok: false,
      code: "cantidad_invalida",
      campo: "cantidad",
      error: `La cantidad no puede pasar de ${formatearCantidad(
        INVENTARIO_CANTIDAD_MAX
      )}.`,
    }
  }
  return {
    ok: true,
    movimiento: { kind: kind as KindMovimiento, cantidad, motivo },
  }
}

/** Versión esperada del compare-and-swap por lote. */
export function validarVersion(raw: unknown): number | null {
  const version = Number(raw)
  return Number.isInteger(version) && version > 0 ? version : null
}

/* ------------------------------- mappers --------------------------------- */

/**
 * Row cruda de Postgres → LoteInventario. La caducidad llega como string
 * «YYYY-MM-DD» (el SELECT la emite con to_char para evitar el parser de
 * DATE de node-pg, que devuelve Date en la zona local del proceso).
 */
export function loteDeRow(row: Record<string, unknown>): LoteInventario {
  return {
    id: String(row.id),
    articuloId: String(row.articulo_id),
    sku: typeof row.sku === "string" ? row.sku : "",
    nombre: typeof row.nombre === "string" ? row.nombre : "",
    um: typeof row.um === "string" ? row.um : "",
    lote: typeof row.lote === "string" ? row.lote : null,
    caducidad: typeof row.caducidad === "string" ? row.caducidad : null,
    condicion: parsearCondicion(row.condicion),
    ubicacion: typeof row.ubicacion === "string" ? row.ubicacion : null,
    cantidad: Number(row.cantidad ?? 0),
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

/** Row cruda de Postgres → MovimientoInventario (delta numérico con signo). */
export function movimientoDeRow(
  row: Record<string, unknown>
): MovimientoInventario {
  const kind = KINDS.includes(row.kind as KindMovimiento)
    ? (row.kind as KindMovimiento)
    : "ajuste"
  return {
    id: String(row.id),
    loteId: String(row.lote_id),
    articuloId: String(row.articulo_id),
    sku: typeof row.sku === "string" ? row.sku : "",
    nombre: typeof row.nombre === "string" ? row.nombre : "",
    lote: typeof row.lote === "string" ? row.lote : null,
    kind,
    delta: Number(row.delta ?? 0),
    cantidadAntes: Number(row.cantidad_antes ?? 0),
    cantidadDespues: Number(row.cantidad_despues ?? 0),
    motivo: typeof row.motivo === "string" ? row.motivo : null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
  }
}
