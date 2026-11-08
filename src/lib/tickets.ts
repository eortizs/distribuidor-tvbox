/**
 * Dominio puro del módulo Alta de tickets (`/modulos/alta-de-tickets`).
 *
 * Lo consume el cliente (tipos, formato, edición del formulario), el
 * servidor (validación de la extracción del LLM y de las correcciones del
 * usuario) y el test `scripts/test-tickets.mjs`. No toca base de datos, red
 * ni archivos: la extracción vive en `src/server/tickets/llm.ts` y la
 * persistencia en `src/server/tickets/{repository,service}.ts`.
 *
 * Los montos se guardan como cadenas decimales canónicas (nunca flotantes)
 * y la conciliación se hace en centavos enteros. Lo ilegible o ausente es
 * `null`: nunca un cero inventado. El texto de la imagen es dato, no
 * instrucción: se almacena tal cual, sin interpretarlo.
 */

export const ENTITY_NAME_TICKET = "TicketCompra"

/** Versión del esquema de `datos` guardado en dynamicProperties. */
export const TICKET_SCHEMA_VERSION = 1

/** Claves usadas dentro de `dynamicProperties` del documento umeJSON. */
export const TICKET_KEYS = {
  fileId: "fileId",
  schemaVersion: "ticketSchemaVersion",
  datos: "datos",
  advertencias: "advertencias",
  extraccion: "extraccion",
  revisadoAt: "revisadoAt",
} as const

// Límites duros de dominio: el API rechaza o recorta antes de guardar.
export const MAX_PRODUCTOS = 200
export const MAX_DESCRIPCION = 500
export const MAX_ADVERTENCIAS = 20
export const MAX_ADVERTENCIA = 300
export const MAX_COMERCIO = 120
export const MAX_DIRECCION = 200
export const MAX_FOLIO = 60
export const MAX_FORMA_PAGO = 60
export const MAX_UNIDAD = 20
export const MAX_IMPUESTOS = 5
export const MAX_CANTIDAD = 9999
export const MAX_MONTO = 99_999_999.99

export interface ComercioTicket {
  nombre: string | null
  rfc: string | null
  direccion: string | null
}

export interface ImpuestoTicket {
  /** "IVA", "IEPS", tal como aparece impreso. */
  nombre: string
  /** Tasa legible en el ticket ("16%"), si está. */
  tasa: string | null
  importe: string
}

export interface ProductoTicket {
  descripcion: string
  /** null = cantidad ilegible o no impresa. */
  cantidad: number | null
  unidad: string | null
  precioUnitario: string | null
  descuento: string | null
  importe: string | null
}

export interface DatosTicket {
  comercio: ComercioTicket
  /** Fecha local impresa, ISO YYYY-MM-DD; null = ilegible o ambigua. */
  fecha: string | null
  /** Hora local HH:mm; null = ilegible. */
  hora: string | null
  folio: string | null
  /** Código ISO 4217 en mayúsculas; null = ilegible. Nunca se infiere. */
  moneda: string | null
  productos: ProductoTicket[]
  subtotal: string | null
  descuentos: string | null
  impuestos: ImpuestoTicket[]
  propina: string | null
  total: string | null
  formaPago: string | null
}

/** Metadatos de la extracción automática (nunca los escribe el cliente). */
export interface ExtraccionTicket {
  /** Modelo que produjo la extracción, p. ej. "openai/gpt-6-luna". */
  modelo: string
  fecha: string
  /** Número de intento de análisis que produjo este resultado. */
  intento: number
}

/** Estado del análisis del LLM sobre la foto (tabla `tickets`). */
export type ScanEstado = "pending" | "processing" | "succeeded" | "failed"

/** Tope de la foto del ticket: el mismo que el servidor aplica. */
export const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024

/** Estado de revisión del ticket (state.current del documento). */
export type EstadoTicket = "borrador" | "revision" | "confirmado"

export const ETIQUETA_ESTADO: Record<EstadoTicket, string> = {
  borrador: "Borrador",
  revision: "En revisión",
  confirmado: "Confirmado",
}

const ESTADO_UME_A_TICKET: Record<string, EstadoTicket> = {
  draft: "borrador",
  validation_required: "revision",
  active: "confirmado",
}

export function estadoTicketDeUme(current: unknown): EstadoTicket {
  if (typeof current === "string") return ESTADO_UME_A_TICKET[current] ?? "borrador"
  return "borrador"
}

/* ------------------------------ Montos ---------------------------------- */

/**
 * Normaliza un monto a cadena decimal canónica con 2 decimales (redondeo
 * half-up sobre la tercera decimal, con aritmética de cadenas: nada de
 * flotantes). Acepta números JSON y textos con "$", comas de millar y
 * espacios. Devuelve null si no es un monto válido (incluye 0 de más de
 * 12 dígitos, negativos o basura): el dato se pierde como desconocido,
 * jamás se adivina.
 */
export function normalizarMonto(value: unknown): string | null {
  let ent: string
  let dec: string

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > MAX_MONTO) return null
    const texto = value.toString()
    if (texto.includes("e") || texto.includes("E")) return null
    const partes = texto.split(".")
    ent = partes[0]
    dec = partes[1] ?? ""
  } else if (typeof value === "string") {
    const clean = value.replace(/[$\s,]/g, "").trim()
    if (!/^\d+(\.\d+)?$/.test(clean)) return null
    const partes = clean.split(".")
    ent = partes[0].replace(/^0+(?=\d)/, "")
    dec = partes[1] ?? ""
    if (ent.length > 12) return null
  } else {
    return null
  }

  if (ent === "" ) ent = "0"
  const centavos = redondearCentavos(ent, dec)
  if (centavos === null || centavos > Math.round(MAX_MONTO * 100)) return null
  return deCentavos(centavos)
}

function redondearCentavos(ent: string, dec: string): number | null {
  const entero = Number.parseInt(ent, 10)
  if (!Number.isFinite(entero) || entero < 0) return null
  const dos = (dec + "00").slice(0, 2)
  const resto = dec.length > 2 ? dec.slice(2) : ""
  let centavos = entero * 100 + Number.parseInt(dos, 10)
  if (resto.length > 0 && Number(resto[0]) >= 5) centavos += 1
  return centavos
}

/** Cadena canónica → centavos enteros (exacto, sin flotantes). */
export function aCentavos(monto: string): number {
  const [ent, dec = ""] = monto.split(".")
  return Number.parseInt(ent, 10) * 100 + Number.parseInt((dec + "00").slice(0, 2), 10)
}

export function deCentavos(centavos: number): string {
  const ent = Math.floor(centavos / 100)
  const dec = centavos % 100
  return `${ent}.${String(dec).padStart(2, "0")}`
}

/** Suma montos ignorando nulls; null si no hay ninguno conocido. */
export function sumarMontos(montos: (string | null)[]): string | null {
  let total: number | null = null
  for (const monto of montos) {
    if (monto === null) continue
    const valor = aCentavos(monto)
    total = total === null ? valor : total + valor
  }
  return total === null ? null : deCentavos(total)
}

/** "35.1" y "$ 35.10" se muestran como money legible con su moneda. */
export function formatMonto(monto: string | null, moneda: string | null): string {
  if (monto === null) return "—"
  return moneda ? `${monto} ${moneda}` : `$${monto}`
}

/* --------------------------- Fechas y horas ------------------------------ */

function validarCalendario(anio: string, mes: string, dia: string): string | null {
  const y = Number(anio)
  const m = Number(mes)
  const d = Number(dia)
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > diasMes) return null
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/**
 * Acepta ISO (2025-03-07) y fechas cortas solo cuando el día/mes no es
 * ambiguo (07/03/2025 → día 7; 03/25/2025 → mes 3). Ambiguo o imposible:
 * null, sin adivinar.
 */
export function normalizarFecha(value: unknown): string | null {
  if (typeof value !== "string") return null
  const clean = value.trim()
  const iso = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (iso) return validarCalendario(iso[1], iso[2], iso[3])
  const corta = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (corta) {
    const a = Number(corta[1])
    const b = Number(corta[2])
    if (a > 12 && b <= 12) return validarCalendario(corta[3], corta[2], corta[1])
    if (b > 12 && a <= 12) return validarCalendario(corta[3], corta[1], corta[2])
    return null
  }
  return null
}

/** "13:45", "9:05:12 p.m." no; solo 24 h legibles → "HH:mm". */
export function normalizarHora(value: unknown): string | null {
  if (typeof value !== "string") return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

/* ------------------------------ Textos ----------------------------------- */

function normalizarTexto(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return null
  return clean.slice(0, max)
}

/** Mayúscula inicial solo si empieza con letra (para nombres propios). */
function capitalizarPrimeraLetra(texto: string): string {
  if (!texto || !/\p{L}/u.test(texto[0] ?? "")) return texto
  return `${texto[0].toUpperCase()}${texto.slice(1)}`
}

function normalizarMoneda(value: unknown): string | null {
  if (typeof value !== "string") return null
  const clean = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(clean) ? clean : null
}

/** Cantidad de partida: > 0 y ≤ MAX_CANTIDAD, redondeada a 2 decimales. */
function normalizarCantidadProducto(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const clean = Math.round(value * 100) / 100
  if (clean <= 0 || clean > MAX_CANTIDAD) return null
  return clean
}

function normalizarAdvertencias(value: unknown): { lista: string[]; descartadas: number } {
  if (!Array.isArray(value)) return { lista: [], descartadas: 0 }
  const lista: string[] = []
  let descartadas = 0
  for (const item of value.slice(0, MAX_ADVERTENCIAS)) {
    const texto = normalizarTexto(item, MAX_ADVERTENCIA)
    if (texto) lista.push(texto)
    else descartadas += 1
  }
  return { lista, descartadas }
}

/**
 * Avisos legibles de la extracción (los escribe el servidor, nunca el
 * cliente): se normalizan al guardarlos en el documento.
 */
export function normalizarAdvertenciasTicket(value: unknown): string[] {
  return normalizarAdvertencias(value).lista
}

export type ResultadoValidacionTicket =
  | { ok: true; datos: DatosTicket; avisos: string[] }
  | { ok: false; razon: string }

/**
 * Valida y normaliza la entrada del ticket, venga del LLM (JSON crudo) o del
 * formulario de corrección del usuario. Los campos que no se dejen leer o
 * que llegan rotos quedan como null con aviso; nada se inventa. Las partidas
 * que excedan el límite se recortan con aviso explícito.
 */
export function validarEntradaTicket(input: unknown): ResultadoValidacionTicket {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, razon: "Los datos del ticket deben ser un objeto." }
  }
  const raw = input as Record<string, unknown>
  const avisos: string[] = []

  const comercioRaw =
    raw.comercio && typeof raw.comercio === "object" && !Array.isArray(raw.comercio)
      ? (raw.comercio as Record<string, unknown>)
      : {}
  const comercio: ComercioTicket = {
    nombre: (() => {
      const nombre = normalizarTexto(comercioRaw.nombre, MAX_COMERCIO)
      return nombre ? capitalizarPrimeraLetra(nombre) : null
    })(),
    rfc: normalizarTexto(comercioRaw.rfc, 15)?.toUpperCase() ?? null,
    direccion: normalizarTexto(comercioRaw.direccion, MAX_DIRECCION),
  }

  const fecha = normalizarFecha(raw.fecha)
  if (typeof raw.fecha === "string" && raw.fecha.trim() && !fecha) {
    avisos.push("La fecha del ticket no se pudo confirmar (ilegible o ambigua).")
  }
  const hora = normalizarHora(raw.hora)
  const folio = normalizarTexto(raw.folio, MAX_FOLIO)
  const moneda = normalizarMoneda(raw.moneda)
  if (typeof raw.moneda === "string" && raw.moneda.trim() && !moneda) {
    avisos.push("La moneda del ticket no se pudo confirmar.")
  }

  // Partidas: se recortan al límite y las rotas se descartan con aviso.
  const productosRaw = Array.isArray(raw.productos) ? raw.productos : []
  if (productosRaw.length > MAX_PRODUCTOS) {
    avisos.push(
      `El ticket tiene ${productosRaw.length} partidas; se guardaron las primeras ${MAX_PRODUCTOS}.`
    )
  }
  const productos: ProductoTicket[] = []
  let descartadas = 0
  for (const item of productosRaw.slice(0, MAX_PRODUCTOS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      descartadas += 1
      continue
    }
    const p = item as Record<string, unknown>
    const descripcion = normalizarTexto(p.descripcion, MAX_DESCRIPCION)
    if (!descripcion) {
      descartadas += 1
      continue
    }
    productos.push({
      descripcion,
      cantidad: normalizarCantidadProducto(p.cantidad),
      unidad: normalizarTexto(p.unidad, MAX_UNIDAD),
      precioUnitario: normalizarMonto(p.precioUnitario),
      descuento: normalizarMonto(p.descuento),
      importe: normalizarMonto(p.importe),
    })
  }
  if (descartadas > 0) {
    avisos.push(`${descartadas} partida(s) ilegible(s) o vacía(s) se descartaron.`)
  }

  const impuestosRaw = Array.isArray(raw.impuestos) ? raw.impuestos : []
  const impuestos: ImpuestoTicket[] = []
  for (const item of impuestosRaw.slice(0, MAX_IMPUESTOS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const imp = item as Record<string, unknown>
    const nombre = normalizarTexto(imp.nombre, 40)
    const importe = normalizarMonto(imp.importe)
    if (!nombre || !importe) continue
    impuestos.push({ nombre, tasa: normalizarTexto(imp.tasa, 10), importe })
  }

  const datos: DatosTicket = {
    comercio,
    fecha,
    hora,
    folio,
    moneda,
    productos,
    subtotal: normalizarMonto(raw.subtotal),
    descuentos: normalizarMonto(raw.descuentos),
    impuestos,
    propina: normalizarMonto(raw.propina),
    total: normalizarMonto(raw.total),
    formaPago: normalizarTexto(raw.formaPago, MAX_FORMA_PAGO),
  }
  return { ok: true, datos, avisos }
}

/* ---------------------------- Conciliación -------------------------------- */

/**
 * Avisos de inconsistencia aritmética entre los montos impresos. Nunca
 * corrige: el ticket impreso manda y las diferencias se muestran al usuario
 * para que decida (puede ser un redondeo del comercio o un error de lectura).
 */
export function conciliarTicket(datos: DatosTicket): string[] {
  const avisos: string[] = []

  // Partidas vs subtotal: solo cuando todas las partidas tienen importe.
  if (
    datos.subtotal !== null &&
    datos.productos.length > 0 &&
    datos.productos.every((p) => p.importe !== null)
  ) {
    const suma = sumarMontos(datos.productos.map((p) => p.importe))
    const tolerancia = Math.max(2, datos.productos.length)
    if (
      suma !== null &&
      Math.abs(aCentavos(suma) - aCentavos(datos.subtotal)) > tolerancia
    ) {
      avisos.push(
        `La suma de las partidas (${formatMonto(suma, datos.moneda)}) no coincide con el subtotal (${formatMonto(datos.subtotal, datos.moneda)}).`
      )
    }
  }

  // Total vs subtotal − descuentos + impuestos + propina (todo conocido).
  const impuestosConocidos =
    datos.impuestos.length > 0 && datos.impuestos.every((i) => i.importe !== null)
  if (
    datos.total !== null &&
    datos.subtotal !== null &&
    datos.descuentos !== null &&
    datos.propina !== null &&
    impuestosConocidos
  ) {
    const impuestos = sumarMontos(datos.impuestos.map((i) => i.importe))
    if (impuestos !== null) {
      const calculado =
        aCentavos(datos.subtotal) -
        aCentavos(datos.descuentos) +
        aCentavos(impuestos) +
        aCentavos(datos.propina)
      if (Math.abs(calculado - aCentavos(datos.total)) > 2) {
        avisos.push(
          `El total (${formatMonto(datos.total, datos.moneda)}) no cuadra con subtotal, descuentos, impuestos y propina.`
        )
      }
    }
  }

  // Cantidad × precio vs importe impreso, por partida.
  let divergentes = 0
  for (const producto of datos.productos) {
    if (
      producto.cantidad === null ||
      producto.precioUnitario === null ||
      producto.importe === null
    ) {
      continue
    }
    const esperado = Math.round(
      (Math.round(producto.cantidad * 100) * aCentavos(producto.precioUnitario)) / 100
    )
    if (Math.abs(esperado - aCentavos(producto.importe)) > 1) {
      divergentes += 1
    }
  }
  if (divergentes > 0) {
    avisos.push(
      `${divergentes} partida(s) con cantidad × precio distinto al importe impreso.`
    )
  }

  return avisos
}

/* --------------------------- Confirmación --------------------------------- */

/**
 * Campos obligatorios para confirmar un ticket: comercio, fecha, moneda y
 * total conocidos. Las partidas pueden quedar parcialmente ilegibles (con
 * su aviso), pero un confirmado exige al menos el encabezado y el total.
 */
export function camposFaltantesParaConfirmar(datos: DatosTicket | null): string[] {
  if (!datos) {
    return ["Comercio", "Fecha", "Moneda", "Total"]
  }
  const faltantes: string[] = []
  if (!datos.comercio.nombre) faltantes.push("Comercio")
  if (!datos.fecha) faltantes.push("Fecha")
  if (!datos.moneda) faltantes.push("Moneda")
  if (!datos.total) faltantes.push("Total")
  return faltantes
}

/* ------------------------------- Vista ------------------------------------ */

/** Datos vacíos para llenar un ticket a mano (todo desconocido). */
export function vacioDatosTicket(): DatosTicket {
  return {
    comercio: { nombre: null, rfc: null, direccion: null },
    fecha: null,
    hora: null,
    folio: null,
    moneda: null,
    productos: [],
    subtotal: null,
    descuentos: null,
    impuestos: [],
    propina: null,
    total: null,
    formaPago: null,
  }
}

/** Resumen corto para el historial. */
export function resumenTicket(datos: DatosTicket | null): { titulo: string; detalle: string } {
  if (!datos) return { titulo: "Sin datos extraídos", detalle: "Pendiente de análisis" }
  const titulo = datos.comercio.nombre ?? "Ticket sin comercio legible"
  const partes = [datos.fecha ?? null, datos.folio ?? null].filter(Boolean)
  const detalle = [
    partes.join(" · "),
    datos.total !== null ? formatMonto(datos.total, datos.moneda) : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return { titulo, detalle: detalle || "Sin total legible" }
}

/**
 * Vista de un ticket para el cliente: mezcla el documento (estado, versión,
 * datos) con la fila de control (estado del análisis) y los derivados de
 * dominio siempre frescos (discrepancias, campos faltantes).
 */
export interface TicketVista {
  entityId: string
  version: number
  estado: EstadoTicket
  scanEstado: ScanEstado
  scanError: string | null
  datos: DatosTicket | null
  advertencias: string[]
  discrepancias: string[]
  extraccion: { modelo: string; fecha: string; intento: number } | null
  fileId: string
  imagenUrl: string
  confirmable: boolean
  camposFaltantes: string[]
  createdAt: string
  updatedAt: string
}
