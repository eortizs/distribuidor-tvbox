import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import sharp from "sharp"

import {
  ENTITY_NAME_TICKET,
  conciliarTicket,
  camposFaltantesParaConfirmar,
  estadoTicketDeUme,
  TICKET_KEYS,
  TICKET_SCHEMA_VERSION,
  validarEntradaTicket,
  type DatosTicket,
  type TicketVista,
} from "@/lib/tickets"
import type { AuthUser } from "@/server/auth/types"
import { maxUploadBytes, saveUserFile, deleteUserFile, getUserFile, userFilePath } from "@/server/storage/user-files"
import { finalizeDocument } from "@/server/umejson/schema"
import { AppError, SENTINEL, type UmeJson } from "@/server/umejson/types"
import {
  actualizarTicket,
  crearTicketConEntidad,
  guardarErrorScan,
  guardarResultadoScan,
  intentarLeaseScan,
  listarTickets,
  obtenerTicket,
  razonSinLease,
  type TicketFila,
} from "@/server/tickets/repository"
import {
  checkRateLimitScan,
  extraerTicketDeImagen,
  ticketsScanConfigured,
} from "@/server/tickets/llm"

/*
 * Servicio del módulo Alta de tickets: prepara la imagen (validación por
 * decodificación real con sharp, nunca por el MIME del cliente), crea el
 * registro durable (foto + entidad draft) y corre el análisis con el modelo
 * configurado. La subida y el análisis están separados a propósito: un fallo
 * del proveedor no pierde la foto y el intento se puede reintentar.
 */

/** Límite de píxeles para proteger la memoria (bombas de descompresión). */
const MAX_LADO_PX = 12_000
const MAX_PIXELS = 40_000_000
/** Lado mayor de la copia que viaja al modelo: conserva texto legible. */
const ANALISIS_LADO_PX = 2_200
const ANALISIS_JPEG_QUALITY = 88

function leerDatos(doc: UmeJson): DatosTicket | null {
  const datos = doc.dynamicProperties?.[TICKET_KEYS.datos]
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return null
  return datos as DatosTicket
}

function leerAdvertencias(doc: UmeJson): string[] {
  const value = doc.dynamicProperties?.[TICKET_KEYS.advertencias]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function leerExtraccion(doc: UmeJson): TicketVista["extraccion"] {
  const value = doc.dynamicProperties?.[TICKET_KEYS.extraccion]
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.modelo !== "string") return null
  return {
    modelo: raw.modelo,
    fecha: typeof raw.fecha === "string" ? raw.fecha : "",
    intento: typeof raw.intento === "number" ? raw.intento : 0,
  }
}

export function aVista(fila: TicketFila): TicketVista {
  const datos = leerDatos(fila.doc)
  return {
    entityId: fila.entityId,
    version: fila.version,
    estado: estadoTicketDeUme(fila.doc.state?.current),
    scanEstado: fila.scanStatus,
    scanError: fila.scanError,
    datos,
    advertencias: leerAdvertencias(fila.doc),
    discrepancias: datos ? conciliarTicket(datos) : [],
    extraccion: leerExtraccion(fila.doc),
    fileId: fila.fileId,
    imagenUrl: `/api/tickets/${fila.entityId}/imagen`,
    confirmable:
      datos !== null && camposFaltantesParaConfirmar(datos).length === 0,
    camposFaltantes: camposFaltantesParaConfirmar(datos),
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  }
}

/* --------------------------- Imagen segura -------------------------------- */

interface ImagenPreparada {
  bytes: Uint8Array
  mimeType: string
  fileName: string
}

async function metadatos(bytes: Uint8Array) {
  try {
    return await sharp(Buffer.from(bytes), { failOn: "error" }).metadata()
  } catch {
    throw new AppError(
      422,
      "imagen_invalida",
      "No se pudo leer la imagen. Toma la foto de nuevo o elige otro archivo."
    )
  }
}

/**
 * Valida la imagen decodificándola de verdad (firma real, no el MIME del
 * cliente), rechaza animadas y bombas de píxeles, y normaliza HEIC a JPEG
 * solo si el decodificador instalado realmente lo soporta. La copia de
 * análisis corrige la orientación EXIF y quita metadatos sensibles.
 */
async function prepararImagen(
  bytes: Uint8Array,
  fileName: string
): Promise<ImagenPreparada> {
  const meta = await metadatos(bytes)
  const formato = meta.format ?? ""
  const ancho = meta.width ?? 0
  const alto = meta.height ?? 0
  if (!ancho || !alto) {
    throw new AppError(422, "imagen_invalida", "La imagen no tiene dimensiones válidas.")
  }
  if (ancho > MAX_LADO_PX || alto > MAX_LADO_PX || ancho * alto > MAX_PIXELS) {
    throw new AppError(
      422,
      "imagen_demasiado_grande",
      "La imagen es demasiado grande. Reduce su tamaño e intenta de nuevo."
    )
  }
  if ((meta.pages ?? 1) > 1) {
    throw new AppError(
      422,
      "imagen_no_soportada",
      "No se aceptan imágenes animadas. Sube una foto fija del ticket."
    )
  }

  if (formato === "jpeg" || formato === "png" || formato === "webp") {
    const mime =
      formato === "jpeg"
        ? "image/jpeg"
        : formato === "png"
          ? "image/png"
          : "image/webp"
    return { bytes, mimeType: mime, fileName }
  }

  if (formato === "heif") {
    // iPhone/Android moderno: se intenta convertir a JPEG; si el decodificador
    // del servidor no soporta HEIC, se pide JPEG/PNG/WebP sin promesas falsas.
    try {
      const convertido = await sharp(Buffer.from(bytes), { failOn: "error" })
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer()
      const nuevoNombre = fileName.replace(/\.[^.]+$/, "") + ".jpg"
      return {
        bytes: new Uint8Array(convertido),
        mimeType: "image/jpeg",
        fileName: nuevoNombre,
      }
    } catch {
      throw new AppError(
        415,
        "formato_no_soportado",
        "El servidor no puede convertir fotos HEIC. Envía la foto en JPEG, PNG o WebP."
      )
    }
  }

  throw new AppError(
    415,
    "formato_no_soportado",
    "Formato no admitido. Sube la foto en JPEG, PNG o WebP."
  )
}

/** Copia para el modelo: orientación corregida, sin metadatos, JPEG. */
async function copiaAnalisis(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const buffer = await sharp(Buffer.from(bytes), { failOn: "none" })
      .rotate()
      .resize({
        width: ANALISIS_LADO_PX,
        height: ANALISIS_LADO_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: ANALISIS_JPEG_QUALITY })
      .toBuffer()
    return new Uint8Array(buffer)
  } catch {
    throw new AppError(
      422,
      "imagen_invalida",
      "No se pudo preparar la imagen para el análisis. Intenta con otra foto."
    )
  }
}

/* ------------------------------ Alta --------------------------------------- */

function construirDocDraft(userId: string, fileId: string): UmeJson {
  const draft: UmeJson = {
    id: SENTINEL,
    entityName: ENTITY_NAME_TICKET,
    dynamicProperties: {
      distribuidorId: userId,
      [TICKET_KEYS.fileId]: fileId,
      [TICKET_KEYS.schemaVersion]: TICKET_SCHEMA_VERSION,
      [TICKET_KEYS.datos]: null,
      [TICKET_KEYS.advertencias]: [],
      [TICKET_KEYS.extraccion]: null,
    },
    lifecycle: { createdAt: SENTINEL, updatedAt: SENTINEL, deletedAt: null, version: 1 },
    relations: [],
    state: {
      current: "draft",
      statusLog: [{ status: "draft", timestamp: SENTINEL }],
    },
    markdownDocumentation: [
      "# TicketCompra",
      "",
      "Ticket de compra o gasto registrado desde el módulo Alta de tickets.",
      "La foto es un archivo privado del propietario (user_files); los datos",
      "extraídos y corregidos viven en dynamicProperties y el estado sigue el",
      "ciclo draft → validation_required → active.",
    ].join("\n"),
  }
  return finalizeDocument(draft)
}

function validarRequestId(requestId: unknown): string {
  if (typeof requestId !== "string") {
    throw new AppError(
      422,
      "invalid_request",
      "Se requiere un identificador de petición (requestId)."
    )
  }
  const clean = requestId.trim()
  if (clean.length < 1 || clean.length > 64) {
    throw new AppError(
      422,
      "invalid_request",
      "El identificador de petición debe tener entre 1 y 64 caracteres."
    )
  }
  return clean
}

export interface AltaTicketResultado {
  vista: TicketVista
  duplicado: boolean
}

/**
 * Guarda la foto y crea el ticket draft con su fila de control. Devuelve el
 * id durable ANTES de cualquier análisis. Si el archivo es idéntico a uno ya
 * guardado por el mismo usuario, devuelve ese ticket (sin segundo análisis).
 */
export async function crearTicketDesdeArchivo(
  user: AuthUser,
  archivo: File,
  requestIdRaw: unknown
): Promise<AltaTicketResultado> {
  const requestId = validarRequestId(requestIdRaw)
  const maxBytes = maxUploadBytes()
  if (archivo.size === 0) {
    throw new AppError(422, "empty_file", "El archivo está vacío.")
  }
  if (archivo.size > maxBytes) {
    throw new AppError(
      413,
      "file_too_large",
      `La imagen excede el límite de ${maxBytes} bytes.`
    )
  }

  const original = new Uint8Array(await archivo.arrayBuffer())
  const preparada = await prepararImagen(original, archivo.name)
  const sha256 = createHash("sha256").update(preparada.bytes).digest("hex")

  const saved = await saveUserFile({
    userId: user.id,
    kind: "attachment",
    fileName: preparada.fileName,
    mimeType: preparada.mimeType,
    bytes: preparada.bytes,
  })

  try {
    const resultado = await crearTicketConEntidad({
      userId: user.id,
      fileId: saved.id,
      requestId,
      sha256,
      doc: construirDocDraft(user.id, saved.id),
      actor: `user:${user.username}`,
    })
    const vista = await obtenerVista(user.id, resultado.entityId)
    if (!vista) {
      throw new AppError(
        500,
        "internal_error",
        "El ticket se creó pero no se pudo leer. Reintenta."
      )
    }
    return { vista, duplicado: resultado.duplicado }
  } catch (error) {
    // El registro no se creó: la foto no queda como huérfana en disco.
    await deleteUserFile(user.id, saved.id).catch(() => {})
    throw error
  }
}

/* ---------------------------- Análisis ------------------------------------- */

function mensajeSeguro(error: unknown): string {
  if (error instanceof AppError) return error.message
  return "El análisis falló. Puedes reintentarlo o llenar los datos a mano."
}

/**
 * Corre el análisis de un ticket existente: lease en DB (single-flight entre
 * procesos), foto desde el almacenamiento privado, copia de análisis y LLM.
 * El fallo del análisis nunca pierde la foto ni el ticket: queda `failed`
 * con un mensaje seguro y se puede reintentar.
 */
export async function extraerTicket(
  user: AuthUser,
  entityId: string,
  signal?: AbortSignal
): Promise<TicketVista> {
  if (!ticketsScanConfigured()) {
    throw new AppError(
      500,
      "tickets_llm_not_configured",
      "El análisis de tickets no está configurado en el servidor."
    )
  }
  if (!checkRateLimitScan(user.id)) {
    throw new AppError(
      429,
      "rate_limited",
      "Has alcanzado el límite de análisis por minuto. Espera un momento e intenta de nuevo."
    )
  }

  const lease = await intentarLeaseScan(entityId, user.id)
  if (!lease) {
    throw await razonSinLease(entityId, user.id)
  }

  const fila = await obtenerTicket(entityId, user.id)
  const fileId = fila?.fileId
  if (!fila || !fileId) {
    await guardarErrorScan(entityId, user.id, "El ticket ya no existe.", lease.intento)
    throw new AppError(404, "not_found", "Ticket no encontrado")
  }

  const file = await getUserFile(user.id, fileId)
  if (!file) {
    await guardarErrorScan(
      entityId,
      user.id,
      "La foto del ticket ya no está disponible.",
      lease.intento
    )
    throw new AppError(
      404,
      "archivo_no_disponible",
      "La foto del ticket ya no está disponible en el servidor."
    )
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(userFilePath(file)))
  } catch {
    await guardarErrorScan(
      entityId,
      user.id,
      "La foto del ticket no se pudo leer del disco.",
      lease.intento
    )
    throw new AppError(
      500,
      "archivo_ilegible",
      "La foto del ticket no se pudo leer del servidor."
    )
  }

  let analisis: Uint8Array
  try {
    analisis = await copiaAnalisis(bytes)
  } catch (error) {
    await guardarErrorScan(entityId, user.id, mensajeSeguro(error), lease.intento)
    throw error
  }

  let resultado
  try {
    resultado = await extraerTicketDeImagen({ bytes: analisis, signal })
  } catch (error) {
    await guardarErrorScan(entityId, user.id, mensajeSeguro(error), lease.intento)
    throw error
  }

  await guardarResultadoScan(entityId, {
    userId: user.id,
    datos: resultado.esTicket ? resultado.datos : null,
    advertencias: resultado.advertencias,
    modelo: resultado.modelo,
    intento: lease.intento,
  })

  const vista = await obtenerVista(user.id, entityId)
  if (!vista) {
    throw new AppError(404, "not_found", "Ticket no encontrado")
  }
  return vista
}

/* ---------------------------- Lecturas ------------------------------------- */

export interface ListarVistaOpciones {
  estado?: "borrador" | "revision" | "confirmado"
  limit?: number
  offset?: number
}

export async function listarVista(
  userId: string,
  opciones: ListarVistaOpciones = {}
): Promise<{ items: TicketVista[]; total: number }> {
  const resultado = await listarTickets(userId, opciones)
  return { items: resultado.items.map(aVista), total: resultado.total }
}

export async function obtenerVista(
  userId: string,
  entityId: string
): Promise<TicketVista | null> {
  const fila = await obtenerTicket(entityId, userId)
  return fila ? aVista(fila) : null
}

/* --------------------------- Corrección ------------------------------------ */

/** Valida los datos corregidos desde el formulario y los normaliza. */
export function validarDatosCorregidos(raw: unknown): DatosTicket {
  const resultado = validarEntradaTicket(raw)
  if (!resultado.ok) {
    throw new AppError(422, "datos_invalidos", resultado.razon)
  }
  return resultado.datos
}

export async function corregirTicket(params: {
  user: AuthUser
  entityId: string
  expectedVersion: number
  datos?: DatosTicket
  confirmar: boolean
}): Promise<TicketVista> {
  await actualizarTicket(params.entityId, {
    userId: params.user.id,
    expectedVersion: params.expectedVersion,
    datos: params.datos,
    confirmar: params.confirmar,
    actor: `user:${params.user.username}`,
  })
  const vista = await obtenerVista(params.user.id, params.entityId)
  if (!vista) {
    throw new AppError(404, "not_found", "Ticket no encontrado")
  }
  return vista
}
