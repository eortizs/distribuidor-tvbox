/**
 * Dominio puro del módulo Alta de Artículos/Servicios
 * (/modulos/alta-de-articulos): tipos compartidos por servidor y cliente,
 * límites (espejo del CHECK de db/articulos-schema.sql), lista fija de
 * unidades de medida, validación de la forma de un artículo, parser CSV
 * RFC4180 tolerante (autodetecta ',' o ';' y acepta punto o coma decimal),
 * plantilla y reporte de importación. Sin BD ni React: se puede probar con
 * node directo (scripts/test-articulos.mjs).
 */

/** Máximo de caracteres del SKU (tras recortar; se guarda en MAYÚSCULAS). */
export const ARTICULO_SKU_MAX = 40

/** Máximo de caracteres del nombre. */
export const ARTICULO_NOMBRE_MAX = 120

/** Máximo de caracteres de la descripción. */
export const ARTICULO_DESCRIPCION_MAX = 2000

/** Máximo de caracteres de la categoría. */
export const ARTICULO_CATEGORIA_MAX = 60

/** Máximo de caracteres de la U.M. (incluye el texto libre de «Otro»). */
export const ARTICULO_UM_MAX = 30

/** Tope del precio unitario en MXN (espejo del CHECK). */
export const ARTICULO_PRECIO_MAX = 1_000_000

/**
 * Descripción que viaja en los LISTADOS: el detalle completo (≤2000 chars)
 * se lee bajo demanda en `/api/articulos/[id]` al editar. Recortarla aquí
 * mantiene el payload del acordeón acotado aunque el negocio tenga 5000
 * artículos. NUNCA se usa en escrituras: el PATCH necesita el texto completo.
 */
export const ARTICULO_LISTA_DESCRIPCION_MAX = 240

/** Tope de artículos por tenant (lo aplica el repositorio en transacción). */
export const ARTICULOS_MAX_POR_TENANT = 5000

/** Tope de filas por archivo de importación. */
export const IMPORT_MAX_FILAS = 1000

/** Tope de bytes del archivo de importación (2 MB). */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024

/** Mínimo de caracteres para disparar la búsqueda al servidor. */
export const ARTICULOS_BUSQUEDA_MIN = 2

/** Tamaño de página del listado (servidor). El tope permite pedir el
 * catálogo completo de una sola vez: los acordeones de Alta de Artículos y
 * Nota Digital no paginan. */
export const ARTICULOS_PAGE_SIZE_DEFAULT = 25
export const ARTICULOS_PAGE_SIZE_MAX = ARTICULOS_MAX_POR_TENANT

/**
 * Unidades de medida de la lista fija. `um` se guarda como código; «Otro»
 * abre texto libre que se guarda verbatim (≤30, sin vacíos). El CSV acepta
 * código o etiqueta, sin acentos ni mayúsculas.
 */
export const UM_OPCIONES = [
  { code: "pieza", label: "Pieza" },
  { code: "servicio", label: "Servicio" },
  { code: "hora", label: "Hora" },
  { code: "kg", label: "Kg" },
  { code: "g", label: "g" },
  { code: "l", label: "L" },
  { code: "ml", label: "ml" },
  { code: "m", label: "m" },
  { code: "cm", label: "cm" },
  { code: "caja", label: "Caja" },
  { code: "paquete", label: "Paquete" },
] as const

export type UmOpcion = (typeof UM_OPCIONES)[number]

/** Código del valor «Otro» del selector (no se guarda: abre texto libre). */
export const UM_OTRO = "otro"

const UM_POR_CODIGO = new Map<string, UmOpcion>(
  UM_OPCIONES.map((opcion) => [opcion.code, opcion])
)

/** Artículo completo: la forma que devuelve el servidor al leer/editar. */
export interface Articulo {
  id: string
  sku: string
  nombre: string
  descripcion: string
  um: string
  precioUnitario: number
  categoria: string | null
  disponible: boolean
  status: "active" | "archived"
  version: number
  createdAt: string
  updatedAt: string
}

/** Entrada de creación/edición ya sanitizada. */
export interface ArticuloInput {
  sku: string
  nombre: string
  descripcion: string
  um: string
  precioUnitario: number
  categoria: string | null
  disponible: boolean
}

export type ValidacionArticulo =
  | { ok: true; articulo: ArticuloInput }
  | { ok: false; code: string; campo?: string; error: string }

const ARTICULO_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un id con forma de uuid evita que llegue al caster de Postgres. */
export function esArticuloIdValido(id: unknown): id is string {
  return typeof id === "string" && ARTICULO_ID_RE.test(id)
}

/** Quita acentos y pasa a minúsculas (para comparar sin ruido). */
export function normalizarTexto(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/** SKU canónico: recortado y en MAYÚSCULAS — la unicidad (tenant, sku) es
 * case-insensitive por construcción y el upsert del CSV la usa directo. */
export function normalizarSku(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : ""
}

/** Etiqueta visible de la U.M.: la del código fijo o el texto libre tal cual. */
export function umEtiqueta(um: string): string {
  return UM_POR_CODIGO.get(um)?.label ?? um
}

/** Valida la U.M.: código fijo, etiqueta de la lista (sin acentos) o texto
 * libre de «Otro». Devuelve el valor a guardar (código o texto). */
export function normalizarUm(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const texto = raw.trim()
  if (!texto) return null
  const directo = UM_POR_CODIGO.get(texto)
  if (directo) return directo.code
  const clave = normalizarTexto(texto)
  const porEtiqueta = UM_OPCIONES.find(
    (opcion) =>
      normalizarTexto(opcion.label) === clave || opcion.code === clave
  )
  if (porEtiqueta) return porEtiqueta.code
  if (clave === UM_OTRO) return null // «Otro» sin texto: la UI pide el texto
  if (texto.length > ARTICULO_UM_MAX) return null
  return texto
}

/**
 * Importe legible a número con 2 decimales, o null si no se entiende con
 * certeza. Acepta «55.00», «55,00», «1,234.50» y «1.234,50»; rechaza las
 * formas ambiguas («12.345» podría ser 12 o 12345) — patrón de
 * `leerImporteDeComprobante` en links-pago.
 */
export function parsearPrecio(raw: unknown): number | null {
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
    if (/^\d{1,3}(,\d{3})+$/.test(cuerpo)) {
      canon = cuerpo.split(",").join("") // miles: 1,234
    } else if (/^\d+,\d{1,2}$/.test(cuerpo)) {
      canon = cuerpo.replace(",", ".") // decimal: 55,50
    } else {
      return null // ambiguo o con más de 2 decimales
    }
  } else if (tienePunto) {
    if (/^\d+\.\d{1,2}$/.test(cuerpo)) {
      canon = cuerpo // decimal: 55.50
    } else {
      return null // 12.345, 1.234.567: ambiguo o inválido
    }
  } else {
    canon = cuerpo // entero: 55
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(canon)) return null
  const parsed = Number(canon)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100) / 100
}

/**
 * Booleano tolerante del CSV: «si/sí/true/1/verdadero» → true,
 * «no/false/0/falso» → false, vacío → el fallback (true por defecto),
 * cualquier otra cosa → null (error de fila).
 */
export function parsearBooleano(
  raw: unknown,
  fallback: boolean
): boolean | null {
  if (raw === undefined || raw === null || raw === "") return fallback
  if (raw === true) return true
  if (raw === false) return false
  if (typeof raw === "number") {
    if (raw === 1) return true
    if (raw === 0) return false
    return null
  }
  if (typeof raw !== "string") return null
  const clave = normalizarTexto(raw.trim())
  if (!clave) return fallback
  if (["si", "sí", "true", "1", "verdadero", "v", "yes", "y"].includes(clave)) {
    return true
  }
  if (["no", "false", "0", "falso", "f", "n"].includes(clave)) return false
  return null
}

/** Status válido del PATCH (archivar/restaurar). */
export function parsearStatus(raw: unknown): "active" | "archived" | null {
  return raw === "active" || raw === "archived" ? raw : null
}

/**
 * Sanitiza y valida la entrada de crear/editar un artículo. Reemplazo
 * completo: todos los campos quedan como envía el cliente (para el toggle
 * de disponible o el archivado se reenvía el contenido actual). Errores
 * legibles en español, con el campo señalado para el formulario.
 */
export function validarArticuloInput(raw: unknown): ValidacionArticulo {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "invalid_request",
      error:
        "Solicitud inválida: se esperaba { sku, nombre, um, precioUnitario, ... }.",
    }
  }
  const data = raw as Record<string, unknown>

  const sku = normalizarSku(data.sku)
  if (!sku) {
    return {
      ok: false,
      code: "sku_invalido",
      campo: "sku",
      error: "El SKU es obligatorio.",
    }
  }
  if (sku.length > ARTICULO_SKU_MAX) {
    return {
      ok: false,
      code: "sku_invalido",
      campo: "sku",
      error: `El SKU no puede pasar de ${ARTICULO_SKU_MAX} caracteres.`,
    }
  }

  const nombre = typeof data.nombre === "string" ? data.nombre.trim() : ""
  if (!nombre) {
    return {
      ok: false,
      code: "nombre_invalido",
      campo: "nombre",
      error: "El nombre es obligatorio.",
    }
  }
  if (nombre.length > ARTICULO_NOMBRE_MAX) {
    return {
      ok: false,
      code: "nombre_invalido",
      campo: "nombre",
      error: `El nombre no puede pasar de ${ARTICULO_NOMBRE_MAX} caracteres.`,
    }
  }

  const descripcion =
    typeof data.descripcion === "string" ? data.descripcion.trim() : ""
  if (descripcion.length > ARTICULO_DESCRIPCION_MAX) {
    return {
      ok: false,
      code: "descripcion_invalida",
      campo: "descripcion",
      error: `La descripción no puede pasar de ${ARTICULO_DESCRIPCION_MAX} caracteres.`,
    }
  }

  const um = normalizarUm(data.um)
  if (!um) {
    return {
      ok: false,
      code: "um_invalida",
      campo: "um",
      error: "Elige una unidad de medida de la lista o escribe una en «Otro».",
    }
  }

  const precioUnitario = parsearPrecio(data.precioUnitario)
  if (precioUnitario === null) {
    return {
      ok: false,
      code: "precio_invalido",
      campo: "precioUnitario",
      error: "El precio unitario debe ser un monto válido con hasta 2 decimales.",
    }
  }
  if (precioUnitario > ARTICULO_PRECIO_MAX) {
    return {
      ok: false,
      code: "precio_invalido",
      campo: "precioUnitario",
      error: `El precio unitario no puede pasar de ${ARTICULO_PRECIO_MAX.toLocaleString(
        "es-MX"
      )} MXN.`,
    }
  }

  let categoria: string | null = null
  if (typeof data.categoria === "string") {
    const texto = data.categoria.trim()
    if (texto) {
      if (texto.length > ARTICULO_CATEGORIA_MAX) {
        return {
          ok: false,
          code: "categoria_invalida",
          campo: "categoria",
          error: `La categoría no puede pasar de ${ARTICULO_CATEGORIA_MAX} caracteres.`,
        }
      }
      categoria = texto
    }
  } else if (data.categoria !== undefined && data.categoria !== null) {
    return {
      ok: false,
      code: "categoria_invalida",
      campo: "categoria",
      error: "La categoría debe ser texto.",
    }
  }

  const disponible = parsearBooleano(data.disponible, true)
  if (disponible === null) {
    return {
      ok: false,
      code: "disponible_invalido",
      campo: "disponible",
      error: "El campo disponible debe ser sí o no.",
    }
  }

  return {
    ok: true,
    articulo: {
      sku,
      nombre,
      descripcion,
      um,
      precioUnitario,
      categoria,
      disponible,
    },
  }
}

/** Versión esperada del compare-and-swap por artículo. */
export function validarVersion(raw: unknown): number | null {
  const version = Number(raw)
  return Number.isInteger(version) && version > 0 ? version : null
}

/** Row cruda de Postgres (snake_case, fechas Date) → Articulo para la API. */
export function articuloDeRow(row: Record<string, unknown>): Articulo {
  return {
    id: String(row.id),
    sku: typeof row.sku === "string" ? row.sku : "",
    nombre: typeof row.nombre === "string" ? row.nombre : "",
    descripcion: typeof row.descripcion === "string" ? row.descripcion : "",
    um: typeof row.um === "string" ? row.um : "",
    precioUnitario: Number(row.precio_unitario ?? 0),
    categoria: typeof row.categoria === "string" ? row.categoria : null,
    disponible: row.disponible === true,
    status: row.status === "archived" ? "archived" : "active",
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

/**
 * Row cruda de Postgres → Articulo para el listado: la descripción llega
 * recortada para no multiplicar el payload por 5000 filas. La edición usa
 * `articuloDeRow` (sin recortar) leyendo el registro individual.
 */
export function articuloResumenDeRow(row: Record<string, unknown>): Articulo {
  const articulo = articuloDeRow(row)
  if (articulo.descripcion.length <= ARTICULO_LISTA_DESCRIPCION_MAX) {
    return articulo
  }
  return {
    ...articulo,
    descripcion: `${articulo.descripcion
      .slice(0, ARTICULO_LISTA_DESCRIPCION_MAX)
      .trimEnd()}…`,
  }
}

/** Escapa los comodines de ILIKE para buscar el texto literal. */
export function patronBusqueda(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

/* ------------------------------- CSV (RFC4180) ----------------------------- */

/** Campos canónicos del CSV de importación. */
export type CampoCsv =
  | "sku"
  | "nombre"
  | "descripcion"
  | "um"
  | "precio_unitario"
  | "categoria"
  | "disponible"

/** Cabeceras canónicas de la plantilla, en orden. */
export const CSV_HEADERS: CampoCsv[] = [
  "sku",
  "nombre",
  "descripcion",
  "um",
  "precio_unitario",
  "categoria",
  "disponible",
]

/**
 * Alias de cabecera aceptados, ya normalizados (sin acentos, sin puntos ni
 * espacios): «P.U.» → «pu», «Unidad de medida» → «unidadmedida». Las
 * cabeceras desconocidas se ignoran; faltantes/duplicadas de un campo
 * obligatorio son error de archivo.
 */
const ALIAS_CABECERAS: Record<CampoCsv, string[]> = {
  sku: ["sku"],
  nombre: ["nombre", "name", "producto", "articulo", "titulo"],
  descripcion: ["descripcion", "desc", "detalle"],
  um: ["um", "unidad", "unidaddemedida", "unidadmedida"],
  precio_unitario: ["preciounitario", "precio", "pu", "costo", "importe"],
  categoria: ["categoria", "category", "rubro"],
  disponible: ["disponible", "available"],
}

const CAMPOS_OBLIGATORIOS: CampoCsv[] = ["sku", "nombre", "um", "precio_unitario"]

function claveCabecera(raw: string): string {
  return normalizarTexto(raw).replace(/[^a-z0-9]/g, "")
}

export interface MapaCabeceras {
  campo: CampoCsv
  indice: number
}

export type MapeoCabeceras =
  | { ok: true; mapa: MapaCabeceras[] }
  | { ok: false; error: string }

/** Resuelve la fila de cabecera del CSV a índices por campo canónico. */
export function mapearEncabezados(header: string[]): MapeoCabeceras {
  const mapa: MapaCabeceras[] = []
  const faltantes: CampoCsv[] = []
  const duplicados: string[] = []
  for (const campo of CSV_HEADERS) {
    const claves = new Set([
      campo,
      ...ALIAS_CABECERAS[campo].map((alias) => claveCabecera(alias)),
    ])
    const indices: number[] = []
    header.forEach((celda, indice) => {
      if (claves.has(claveCabecera(celda))) indices.push(indice)
    })
    if (indices.length === 0) {
      if (CAMPOS_OBLIGATORIOS.includes(campo)) faltantes.push(campo)
      continue // opcional ausente: se usa su valor por defecto
    }
    if (indices.length > 1) duplicados.push(campo)
    mapa.push({ campo, indice: indices[0] })
  }
  if (faltantes.length > 0) {
    return {
      ok: false,
      error: `Faltan columnas obligatorias en el archivo: ${faltantes.join(
        ", "
      )}. Descarga la plantilla para ver el formato.`,
    }
  }
  if (duplicados.length > 0) {
    return {
      ok: false,
      error: `Columnas repetidas en el archivo: ${duplicados.join(", ")}.`,
    }
  }
  return { ok: true, mapa }
}

/** Delimitador detectado en la primera línea fuera de comillas. */
export function detectarDelimitador(texto: string): string {
  const primera = texto.split(/\r\n|\n|\r/, 1)[0] ?? ""
  let comas = 0
  let puntosComa = 0
  let enComillas = false
  for (const ch of primera) {
    if (ch === '"') enComillas = !enComillas
    else if (!enComillas && ch === ",") comas += 1
    else if (!enComillas && ch === ";") puntosComa += 1
  }
  return puntosComa > comas ? ";" : ","
}

/** Divide el texto en filas de celdas según RFC4180. */
function partirCsv(texto: string, delimitador: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ""
  let enComillas = false
  const n = texto.length
  let i = 0
  while (i < n) {
    const ch = texto[i]
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"'
          i += 2
          continue
        }
        enComillas = false
        i += 1
        continue
      }
      celda += ch
      i += 1
      continue
    }
    if (ch === '"') {
      enComillas = true
      i += 1
      continue
    }
    if (ch === delimitador) {
      fila.push(celda)
      celda = ""
      i += 1
      continue
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && texto[i + 1] === "\n") i += 1
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ""
      i += 1
      continue
    }
    celda += ch
    i += 1
  }
  if (celda !== "" || fila.length > 0) {
    fila.push(celda)
    filas.push(fila)
  }
  return filas
}

/** Error de fila para el reporte de importación. */
export interface ErrorFila {
  /** Número de renglón de datos (1 = primer renglón bajo la cabecera). */
  fila: number
  /** SKU de la fila, si se alcanzó a leer. */
  sku?: string
  /** Campo canónico que falló, si aplica. */
  campo?: string
  motivo: string
}

/** Reporte de la importación (vista previa y resultado). */
export interface InformeImportacion {
  total: number
  nuevos: number
  actualizados: number
  errores: number
  filas: ErrorFila[]
}

export type LecturaCsv =
  | { ok: false; error: string }
  | { ok: true; informe: InformeImportacion; validas: ArticuloInput[] }

/**
 * Lee y valida TODO el archivo: parsea, mapea cabeceras (con alias),
 * valida cada fila con el MISMO validador del formulario y detecta SKUs
 * repetidos dentro del archivo. Un solo problema ⇒ el informe trae errores
 * y la importación no se aplica (todo o nada en el repositorio).
 */
export function leerCsvArticulos(texto: string): LecturaCsv {
  const sinBom = texto.replace(/^\uFEFF/, "")
  if (!sinBom.trim()) {
    return { ok: false, error: "El archivo está vacío." }
  }
  const filas = partirCsv(sinBom, detectarDelimitador(sinBom))
  const conDatos = filas.filter(
    (fila) => !fila.every((celda) => celda.trim() === "")
  )
  if (conDatos.length === 0) {
    return { ok: false, error: "El archivo está vacío." }
  }
  const mapeo = mapearEncabezados(conDatos[0])
  if (!mapeo.ok) return { ok: false, error: mapeo.error }

  const datos = conDatos.slice(1)
  if (datos.length === 0) {
    return {
      ok: false,
      error:
        "El archivo no tiene renglones de datos (solo la cabecera). Descarga la plantilla y agrega tus artículos.",
    }
  }
  if (datos.length > IMPORT_MAX_FILAS) {
    return {
      ok: false,
      error: `El archivo tiene ${datos.length.toLocaleString(
        "es-MX"
      )} renglones; el tope por importación es ${IMPORT_MAX_FILAS.toLocaleString(
        "es-MX"
      )}. Divídelo en varios archivos.`,
    }
  }

  const informe: InformeImportacion = {
    total: datos.length,
    nuevos: 0,
    actualizados: 0,
    errores: 0,
    filas: [],
  }
  const validas: ArticuloInput[] = []
  const skusVistos = new Set<string>()

  datos.forEach((celdas, indice) => {
    const numero = indice + 1
    // El CSV habla snake_case (CampoCsv); la entrada del validador,
    // camelCase. Se traduce en el borde para que AMBOS pasen por el MISMO
    // validador (una sola fuente de verdad).
    const bruto: Record<string, unknown> = {}
    for (const { campo, indice: i } of mapeo.mapa) {
      const valor = celdas[i] ?? ""
      if (campo === "precio_unitario") bruto.precioUnitario = valor
      else bruto[campo] = valor
    }
    // SKU primero: para señalarlo en los errores de la fila.
    const sku = normalizarSku(bruto.sku)
    const validacion = validarArticuloInput(bruto)
    if (!validacion.ok) {
      informe.errores += 1
      informe.filas.push({
        fila: numero,
        sku: sku || undefined,
        campo: validacion.campo,
        motivo: validacion.error,
      })
      return
    }
    if (skusVistos.has(validacion.articulo.sku)) {
      informe.errores += 1
      informe.filas.push({
        fila: numero,
        sku: validacion.articulo.sku,
        campo: "sku",
        motivo:
          "El SKU está repetido dentro del archivo: cada artículo debe tener un SKU distinto.",
      })
      return
    }
    skusVistos.add(validacion.articulo.sku)
    validas.push(validacion.articulo)
  })

  return { ok: true, informe, validas }
}

/** Serializa filas de celdas a CSV RFC4180 (comillas solo cuando hacen falta). */
export function serializarCsv(
  filas: string[][],
  delimitador = ","
): string {
  return filas
    .map((fila) =>
      fila
        .map((celda) => {
          const texto = celda ?? ""
          if (
            texto.includes('"') ||
            texto.includes(delimitador) ||
            texto.includes("\n") ||
            texto.includes("\r")
          ) {
            return `"${texto.split('"').join('""')}"`
          }
          return texto
        })
        .join(delimitador)
    )
    .join("\r\n")
}

/** Fila de ejemplo de la plantilla. */
const EJEMPLO_PLANTILLA: string[][] = [
  [
    "PROD-001",
    "Capuchino grande",
    "Café espresso con leche vaporizada, 16 oz",
    "pieza",
    "55.00",
    "Bebidas",
    "si",
  ],
]

/** Contenido de la plantilla descargable: BOM UTF-8 + cabecera + ejemplo. */
export function plantillaCsv(): string {
  const cuerpo = serializarCsv([CSV_HEADERS, ...EJEMPLO_PLANTILLA])
  return `\uFEFF${cuerpo}\r\n`
}
