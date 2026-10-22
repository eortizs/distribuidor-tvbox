import { readFile } from "node:fs/promises"
import {
  generateImage as generateGatewayImage,
  generateText as generateGatewayText,
} from "ai"
import {
  gateway,
  GatewayAuthenticationError,
  GatewayError,
} from "@ai-sdk/gateway"

import { pool } from "@/server/db"
import { fixRates, mxDayKey, type FixRateInfo } from "@/server/banxico"
import { createSystemExpense } from "@/server/finanzas/gastos"
import {
  deleteUserFile,
  getUserFile,
  maxUploadBytes,
  saveUserFile,
  userFilePath,
  type UserFile,
} from "@/server/storage/user-files"
import {
  VARIANT_MIME_TYPE,
  listFileVariants,
  saveImageVariants,
  variantFileName,
  type FileVariantRecord,
} from "@/server/storage/file-variants"
import type { FileVariant } from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"
import {
  QUALITY_STEPS,
  closestAspect,
  pixelSizeForAspect,
  type ImageModelEntry,
  type QualityStepId,
} from "@/server/images/models"
import { getImageLevels } from "@/server/images/settings"
import {
  buildPromptWithDetails,
  type DetailsFact,
  type DetailsSource,
  type PromptDetailsInput,
  type PromptDetailsResult,
} from "@/server/images/details"
import { buildPromptWithGrounding, groundingConfigured } from "@/server/images/grounding"
import { accrueDetailsCost, consumeDetailsCost } from "@/server/images/details-cost"
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TOTAL_BYTES,
  REFERENCE_IMAGE_TYPES,
} from "@/lib/attachments"

const MAX_PROMPT_LENGTH = 2000
const REQUEST_TIMEOUT_MS = 180_000

/**
 * Calidad enviada al AI Gateway en cada generación: siempre la máxima,
 * para ambos modelos. El slider de la UI elige el modelo; el nivel de
 * render no se negocia.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const

export type AspectRatio = (typeof ASPECT_RATIOS)[number]

export interface ImageVariantPayload {
  variant: FileVariant
  /** URL de la variante; el servidor la deriva del original si aún no existe. */
  url: string
  /** Nombre con el que se descarga. */
  fileName: string
  mimeType: string
  /** null mientras la variante no se ha derivado. */
  sizeBytes: number | null
  width: number | null
  height: number | null
}

export interface ImageFilePayload {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
  /** Versiones derivadas del original: la que se ve en el celular y la
   * miniatura de la galería. El original se conserva para la descarga. */
  variants: {
    low: ImageVariantPayload
    thumb: ImageVariantPayload
  }
}

export interface ImageGenerationPayload {
  id: string
  prompt: string
  model: string
  aspectRatio: string | null
  quality: string | null
  costUsd: number | null
  costMxn: number | null
  createdAt: string
  file: ImageFilePayload | null
}

export interface GenerateImageInput {
  prompt: string
  aspectRatio?: AspectRatio
  /** Nivel del control de calidad ("media" / "alta"). */
  level?: QualityStepId
  /** Ids de los adjuntos del usuario que sirven de imagen de referencia. */
  referenceIds?: readonly string[]
}

interface GenerationRow {
  id: string
  file_id: string | null
  prompt: string
  model: string
  aspect_ratio: string | null
  quality: string | null
  cost_usd: string | null
  created_at: Date
  file_name: string | null
  mime_type: string | null
  size_bytes: string | number | null
}

/*
 * Per-user in-memory buckets. Image generation is expensive; prompt
 * enhancement is cheap but still bounded.
 */
function createRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return function check(userId: string): boolean {
    const now = Date.now()
    if (buckets.size > 1000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key)
      }
    }
    const bucket = buckets.get(userId)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(userId, { count: 1, resetAt: now + windowMs })
      return true
    }
    bucket.count += 1
    return bucket.count <= max
  }
}

export const checkImageRateLimit = createRateLimiter(6, 60_000)
export const checkEnhanceRateLimit = createRateLimiter(10, 60_000)

function isAspectRatio(value: unknown): value is AspectRatio {
  return (
    typeof value === "string" &&
    (ASPECT_RATIOS as readonly string[]).includes(value)
  )
}

function isLevel(value: unknown): value is QualityStepId {
  return (
    typeof value === "string" &&
    (QUALITY_STEPS as readonly { id: string }[]).some((step) => step.id === value)
  )
}

/** Imagen de referencia ya verificada contra su firma de bytes. */
interface ReferenceImage {
  /** Contenido de la imagen. */
  readonly bytes: Uint8Array
  /** Tipo real derivado del contenido. */
  readonly mediaType: string
}

/**
 * Detecta el formato real de una imagen por su firma de bytes. El MIME que
 * envía el navegador no es confiable (lo declara el cliente), así que el tipo
 * que se manda al proveedor se deriva del contenido.
 */
function detectImageMediaType(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte)

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png"
  }
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg"
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif"
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

/**
 * Resuelve los adjuntos del usuario y los devuelve como imágenes de
 * referencia. Solo se aceptan imágenes reales (firma de bytes verificada) y
 * solo archivos del propio usuario.
 */
async function resolveReferenceImages(
  userId: string,
  referenceIds: readonly string[]
): Promise<ReferenceImage[]> {
  const images: ReferenceImage[] = []
  let totalBytes = 0
  for (const id of referenceIds) {
    const file = await getUserFile(userId, id)
    if (!file) {
      throw new AppError(
        422,
        "invalid_reference",
        "Una de las imágenes de referencia ya no está disponible. Vuelve a adjuntarla."
      )
    }
    if (!file.mimeType.startsWith("image/")) {
      throw new AppError(
        422,
        "invalid_reference",
        "Solo se admiten imágenes como referencia."
      )
    }
    const bytes = await readFile(userFilePath(file))
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
      throw new AppError(
        413,
        "references_too_large",
        `Las imágenes de referencia superan el límite de ${MAX_REFERENCE_TOTAL_BYTES} bytes.`
      )
    }
    const mediaType = detectImageMediaType(bytes)
    if (!mediaType || !REFERENCE_IMAGE_TYPES.includes(mediaType as never)) {
      throw new AppError(
        422,
        "invalid_reference",
        "Solo se admiten imágenes PNG, JPEG, GIF o WebP como referencia."
      )
    }
    images.push({ bytes, mediaType })
  }
  return images
}

export function sanitizeImageInput(input: unknown):
  | {
      ok: true
      prompt: string
      aspectRatio?: AspectRatio
      level?: QualityStepId
      referenceIds: string[]
    }
  | { ok: false } {
  if (typeof input !== "object" || input === null) return { ok: false }
  const { prompt, aspectRatio, level, referenceIds } = input as Record<
    string,
    unknown
  >
  if (typeof prompt !== "string") return { ok: false }
  const trimmed = prompt.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PROMPT_LENGTH) {
    return { ok: false }
  }
  if (aspectRatio !== undefined && !isAspectRatio(aspectRatio)) {
    return { ok: false }
  }
  if (level !== undefined && !isLevel(level)) return { ok: false }
  let references: string[] = []
  if (referenceIds !== undefined) {
    if (!Array.isArray(referenceIds)) return { ok: false }
    if (referenceIds.length > MAX_REFERENCE_FILES) return { ok: false }
    for (const id of referenceIds) {
      if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false }
    }
    references = [...(referenceIds as string[])]
  }
  return {
    ok: true,
    prompt: trimmed,
    aspectRatio: isAspectRatio(aspectRatio) ? aspectRatio : undefined,
    level: isLevel(level) ? level : undefined,
    referenceIds: references,
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/svg+xml") return "svg"
  return "png"
}

function slugifyPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
  return slug || "imagen"
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

type VariantIndex = Map<string, Partial<Record<FileVariant, FileVariantRecord>>>

/**
 * Datos de una variante para el cliente. La URL siempre está: si la variante
 * todavía no se ha derivado, el servidor la deriva del original al primer
 * pedido (así la galería no depende de un backfill previo).
 */
function variantPayload(
  fileId: string,
  fileName: string,
  variant: FileVariant,
  record: FileVariantRecord | undefined
): ImageVariantPayload {
  return {
    variant,
    url: `/api/files/${fileId}?variant=${variant}`,
    fileName: variantFileName(fileName, variant),
    mimeType: record?.mimeType ?? VARIANT_MIME_TYPE,
    sizeBytes: record?.sizeBytes ?? null,
    width: record?.width ?? null,
    height: record?.height ?? null,
  }
}

function mapGenerationRow(
  row: GenerationRow,
  rate: number | null = null,
  variants: VariantIndex = new Map()
): ImageGenerationPayload {
  const file =
    row.file_id && row.file_name && row.mime_type
      ? {
          id: row.file_id,
          fileName: row.file_name,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes ?? 0),
          url: `/api/files/${row.file_id}`,
          variants: {
            low: variantPayload(
              row.file_id,
              row.file_name,
              "low",
              variants.get(row.file_id)?.low
            ),
            thumb: variantPayload(
              row.file_id,
              row.file_name,
              "thumb",
              variants.get(row.file_id)?.thumb
            ),
          },
        }
      : null
  const costUsd = row.cost_usd === null ? null : Number(row.cost_usd)
  return {
    id: row.id,
    prompt: row.prompt,
    model: row.model,
    aspectRatio: row.aspect_ratio,
    quality: row.quality,
    costUsd,
    costMxn:
      costUsd === null || rate === null ? null : round6(costUsd * rate),
    createdAt: row.created_at.toISOString(),
    file,
  }
}

const SELECT_GENERATION = `
  SELECT g.id, g.file_id, g.prompt, g.model, g.aspect_ratio, g.quality,
         g.cost_usd, g.created_at,
         f.file_name, f.mime_type, f.size_bytes
    FROM image_generations g
    LEFT JOIN user_files f ON f.id = g.file_id`

export interface LifetimeCost {
  totalUsd: number
  /** null when the Banxico rate is unavailable for at least one costed day */
  totalMxn: number | null
  /** FIX rate (MXN per USD) per calendar day of use, null when unknown */
  rates: Map<string, number | null>
  latest: FixRateInfo | null
}

/** Lifetime provider spend: soft-deleted generations still cost money. */
async function lifetimeCost(userId: string): Promise<LifetimeCost> {
  const result = await pool.query(
    `SELECT (created_at AT TIME ZONE 'America/Mexico_City')::date::text AS day,
            SUM(cost_usd)::float8 AS cost
       FROM image_generations
      WHERE user_id = $1 AND cost_usd IS NOT NULL
      GROUP BY 1`,
    [userId]
  )
  const usdByDay = new Map<string, number>()
  let totalUsd = 0
  for (const row of result.rows as { day: string; cost: number }[]) {
    totalUsd += row.cost
    usdByDay.set(row.day, row.cost)
  }
  totalUsd = round6(totalUsd)
  // Today is always requested: the caller may be about to bill a new
  // generation on a day that has no stored rows yet.
  const requestedDays = [...usdByDay.keys(), mxDayKey(new Date())]
  const { rates, latest } = await fixRates(requestedDays)
  if (usdByDay.size === 0) {
    return { totalUsd: 0, totalMxn: 0, rates, latest }
  }
  let totalMxn = 0
  for (const [day, cost] of usdByDay) {
    const rate = rates.get(day)
    if (rate === undefined || rate === null) {
      return { totalUsd, totalMxn: null, rates, latest }
    }
    totalMxn += cost * rate
  }
  return { totalUsd, totalMxn: round6(totalMxn), rates, latest }
}

/*
 * Records provider spend for a generation whose binary could not be stored:
 * billing must never depend on file persistence succeeding.
 */
async function recordCostOnly(
  userId: string,
  prompt: string,
  model: string,
  aspectRatio: string | null,
  quality: string | null,
  costUsd: number | null,
  day: string,
  rate: number | null
): Promise<void> {
  const generationId = crypto.randomUUID()
  try {
    await pool.query(
      `INSERT INTO image_generations (id, user_id, file_id, prompt, model, aspect_ratio, quality, cost_usd)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
      [generationId, userId, prompt, model, aspectRatio, quality, costUsd]
    )
  } catch {
    return
  }
  if (costUsd !== null) {
    await mirrorCostExpense({ generationId, userId, prompt, model, costUsd, day, rate })
  }
}

/*
 * Mirrors a metered generation cost into the user's expense control so it
 * shows up in Gastos, Estado de cuenta and assistant reports. Best effort by
 * design: a failure here must never fail (or roll back) the generation, and
 * the unique source_image_id makes repeated calls idempotent.
 */
async function mirrorCostExpense(params: {
  generationId: string
  userId: string
  prompt: string
  model: string
  costUsd: number
  day: string
  rate: number | null
}): Promise<void> {
  if (!(params.costUsd > 0)) return
  try {
    await createSystemExpense({
      userId: params.userId,
      sourceImageId: params.generationId,
      description: `Imagen IA — ${params.prompt.replace(/\s+/g, " ").trim().slice(0, 120)}`,
      notes: `Modelo: ${params.model}`,
      amount: params.costUsd,
      spentOn: params.day,
      exchangeRate: params.rate,
      mxnEquivalent:
        params.rate !== null
          ? Math.round(params.costUsd * params.rate * 1e6) / 1e6
          : null,
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: expense mirror failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    )
  }
}

/** Imagen devuelta por el proveedor, ya decodificada. */
interface GeneratedImage {
  bytes: Uint8Array
  mimeType: string
  costUsd: number | null
  model: string
  /** Calidad de render usada (null si el modelo no expone calidad). */
  quality: string | null
  /** Aspecto realmente aplicado (el ajustado al modelo, si hizo falta). */
  aspect: string | null
}

/** Traduce el error del gateway a un error de la API. */
function imageProviderError(error: unknown): AppError {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new AppError(
      504,
      "image_provider_timeout",
      "El proveedor del modelo tardó demasiado en generar la imagen. Inténtalo de nuevo."
    )
  }
  if (GatewayAuthenticationError.isInstance(error)) {
    return new AppError(
      502,
      "image_provider_error",
      "El servidor no está autorizado frente al AI Gateway (revisa AI_GATEWAY_API_KEY)."
    )
  }
  if (GatewayError.isInstance(error) && error.statusCode === 429) {
    return new AppError(
      429,
      "image_provider_error",
      "El proveedor del modelo está saturado. Inténtalo de nuevo en unos momentos."
    )
  }
  return new AppError(
    502,
    "image_provider_error",
    "El proveedor del modelo no pudo generar la imagen. Ajusta el prompt e inténtalo de nuevo."
  )
}

/**
 * Costo que reporta el gateway (USD) en los metadatos de la respuesta.
 */
function gatewayCost(metadata: unknown): number | null {
  const cost = (metadata as { gateway?: { cost?: unknown } } | undefined)?.gateway
    ?.cost
  return (typeof cost === "string" || typeof cost === "number") &&
    Number.isFinite(Number(cost))
    ? Number(cost)
    : null
}

/**
 * Genera la imagen con un modelo concreto. Cada familia de proveedor
 * expone los controles de forma distinta: los modelos de imagen aceptan
 * `size`/`aspectRatio` en el cuerpo, y los LLM multimodales (Gemini)
 * devuelven la imagen como parte de la respuesta de texto.
 */
async function generateWithEntry(params: {
  entry: ImageModelEntry
  prompt: string
  references: readonly ReferenceImage[]
  aspect: string
}): Promise<GeneratedImage> {
  const { entry, prompt, references, aspect } = params
  const model = entry.model
  const abortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)

  // El aspecto pedido puede no estar entre los que admite el modelo (la UI
  // ofrece la lista completa): se recorta al más cercano para que la
  // imagen no salga con otra forma sin avisar.
  const requestedAspect = aspect !== "auto" ? aspect : undefined
  const resolvedAspect = requestedAspect
    ? closestAspect(model, requestedAspect)
    : undefined

  // En los modelos de OpenAI el tamaño en píxeles implica el aspecto: si el
  // usuario pide un aspecto, el tamaño lo determina.
  const size =
    model.sizeMode === "pixels"
      ? resolvedAspect
        ? (pixelSizeForAspect(resolvedAspect) ?? entry.size ?? undefined)
        : (entry.size ?? undefined)
      : undefined
  const aspectRatio =
    model.sizeMode !== "pixels" ? resolvedAspect : undefined

  if (model.kind === "language") {
    // Estos modelos a veces responden con texto y sin imagen: se reintenta
    // una vez a mano (el intento vacío no se factura imagen, solo tokens).
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await generateGatewayText({
        model: gateway.languageModel(model.id),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...references.map((image) => ({
                type: "image" as const,
                image: image.bytes,
              })),
            ],
          },
        ],
        providerOptions: {
          [model.providerKey]: {
            imageConfig: {
              ...(aspectRatio ? { aspectRatio } : {}),
              ...(entry.size ? { imageSize: entry.size } : {}),
            },
          },
        },
        maxRetries: 1,
        abortSignal,
      })
      const files = await result.files
      const file = files[0]
      if (file?.uint8Array) {
        return {
          bytes: file.uint8Array,
          mimeType: file.mediaType?.startsWith("image/")
            ? file.mediaType
            : "image/png",
          costUsd: gatewayCost(result.providerMetadata),
          model: model.id,
          quality: null,
          aspect: resolvedAspect ?? null,
        }
      }
    }
    throw new AppError(
      502,
      "image_provider_error",
      "El proveedor no devolvió ninguna imagen. Inténtalo de nuevo."
    )
  }

  const result = await generateGatewayImage({
    model: gateway.imageModel(model.id),
    prompt:
      references.length > 0
        ? { images: references.map((image) => image.bytes), text: prompt }
        : prompt,
    n: 1,
    ...(size ? { size: size as `${number}x${number}` } : {}),
    ...(aspectRatio ? { aspectRatio: aspectRatio as `${number}:${number}` } : {}),
    ...(entry.quality
      ? { providerOptions: { [model.providerKey]: { quality: entry.quality } } }
      : {}),
    abortSignal,
  })

  const image = result.images[0]
  if (!image?.base64) {
    throw new AppError(
      502,
      "image_provider_error",
      "El proveedor no devolvió ninguna imagen. Inténtalo de nuevo."
    )
  }
  return {
    bytes: Uint8Array.from(Buffer.from(image.base64, "base64")),
    mimeType: image.mediaType?.startsWith("image/")
      ? image.mediaType
      : "image/png",
    costUsd: gatewayCost(result.providerMetadata),
    model: model.id,
    quality: entry.quality,
    aspect: resolvedAspect ?? null,
  }
}

export async function generateImage(
  userId: string,
  input: GenerateImageInput
): Promise<{
  image: ImageGenerationPayload
  totalCostUsd: number
  totalCostMxn: number | null
  fx: FixRateInfo | null
}> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new AppError(
      500,
      "image_provider_not_configured",
      "La generación de imágenes no está configurada en el servidor (falta AI_GATEWAY_API_KEY)."
    )
  }

  // El nivel (media/alta) lo elige el slider de la UI; el servidor lo
  // traduce al modelo, la calidad y el tamaño configurados por el usuario.
  // Un nivel desconocido cae al primer nivel configurado.
  const levels = await getImageLevels(userId)
  const level =
    levels.find((candidate) => candidate.id === input.level) ?? levels[0]
  if (!level) {
    throw new AppError(
      500,
      "image_provider_not_configured",
      "La generación de imágenes no está configurada en el servidor (no hay modelos seleccionados)."
    )
  }

  // Las referencias se resuelven antes de llamar al proveedor: un adjunto
  // inválido debe fallar sin gastarle nada al usuario.
  const referenceImages = await resolveReferenceImages(
    userId,
    input.referenceIds ?? []
  )

  const requestedAspect = input.aspectRatio ?? "auto"
  let generated: GeneratedImage
  try {
    generated = await generateWithEntry({
      entry: level.entry,
      prompt: input.prompt,
      references: referenceImages,
      aspect: requestedAspect,
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: model ${level.entry.model.id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
    throw imageProviderError(error)
  }

  const { bytes, mimeType, costUsd: providerCostUsd, model, quality, aspect } = generated
  if (bytes.byteLength === 0) {
    throw new AppError(
      502,
      "image_provider_error",
      "La imagen generada llegó vacía. Inténtalo de nuevo."
    )
  }
  if (bytes.byteLength > maxUploadBytes()) {
    throw new AppError(
      413,
      "file_too_large",
      "La imagen generada excede el límite de almacenamiento."
    )
  }

  // Prorrateo: si el usuario insertó detalles con búsqueda (grounding) antes
  // de generar, ese costo —que no va dentro de ninguna generación— se carga
  // a esta, la primera posterior a la búsqueda (ventana de 30 minutos).
  const detailsCostUsd = consumeDetailsCost(userId)
  const costUsd =
    providerCostUsd === null && detailsCostUsd === null
      ? null
      : round6((providerCostUsd ?? 0) + (detailsCostUsd ?? 0))

  // The provider bills completed generations in full: resolve the user's
  // running total (USD and MXN) before persisting anything, so a later
  // failure can never leave a stored file or row without a total to report
  // against.
  const before = await lifetimeCost(userId)
  const todayKey = mxDayKey(new Date())
  const todayRate = before.rates.get(todayKey) ?? null
  const costMxn =
    costUsd === null || todayRate === null ? null : round6(costUsd * todayRate)

  let saved: UserFile
  try {
    saved = await saveUserFile({
      userId,
      kind: "generated",
      fileName: `${slugifyPrompt(input.prompt)}.${extensionFor(mimeType)}`,
      mimeType,
      bytes,
    })
  } catch (error) {
    await recordCostOnly(
      userId,
      input.prompt,
      model,
      aspect,
      quality,
      costUsd,
      todayKey,
      todayRate
    )
    throw error
  }

  // Las variantes se derivan de una vez: la galería carga la miniatura y el
  // visor carga la versión baja, así que con cientos de imágenes el celular
  // no arrastra los megabytes del original. El original se conserva intacto.
  const derivedVariants = await saveImageVariants(saved, bytes)
  const variantIndex: VariantIndex = new Map([
    [
      saved.id,
      {
        low: derivedVariants.find((record) => record.variant === "low"),
        thumb: derivedVariants.find((record) => record.variant === "thumb"),
      },
    ],
  ])

  const generationId = crypto.randomUUID()
  try {
    const result = await pool.query(
      `INSERT INTO image_generations (id, user_id, file_id, prompt, model, aspect_ratio, quality, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, file_id, prompt, model, aspect_ratio, quality, cost_usd, created_at,
                 $9 AS file_name, $10 AS mime_type, $11 AS size_bytes`,
      [
        generationId,
        userId,
        saved.id,
        input.prompt,
        model,
        aspect,
        quality,
        costUsd,
        saved.fileName,
        saved.mimeType,
        saved.sizeBytes,
      ]
    )
    // Durable from here: the generation row (and its cost) is committed, so
    // no later failure may delete the paid binary.
    if (costUsd !== null) {
      await mirrorCostExpense({
        generationId,
        userId,
        prompt: input.prompt,
        model,
        costUsd,
        day: todayKey,
        rate: todayRate,
      })
    }
    const image = mapGenerationRow(
      result.rows[0] as GenerationRow,
      todayRate,
      variantIndex
    )
    return {
      image,
      totalCostUsd: round6(before.totalUsd + (costUsd ?? 0)),
      // A row without a known USD cost adds nothing to the total, so the
      // lifetime MXN total stays valid; only an unconvertible known cost
      // makes the MXN total unknowable.
      totalCostMxn:
        costUsd === null
          ? before.totalMxn
          : before.totalMxn === null || costMxn === null
            ? null
            : round6(before.totalMxn + costMxn),
      fx: before.latest,
    }
  } catch (error) {
    await recordCostOnly(
      userId,
      input.prompt,
      model,
      aspect,
      quality,
      costUsd,
      todayKey,
      todayRate
    )
    await deleteUserFile(userId, saved.id).catch(() => {})
    throw error
  }
}

export async function listImageGenerations(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{
  images: ImageGenerationPayload[]
  total: number
  totalCostUsd: number
  totalCostMxn: number | null
  fx: FixRateInfo | null
}> {
  const values: unknown[] = [userId]
  const totalResult = await pool.query(
    `SELECT count(*)::int AS count
       FROM image_generations
      WHERE user_id = $1 AND deleted_at IS NULL AND file_id IS NOT NULL`,
    values
  )
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200)
  const offset = Math.max(options.offset ?? 0, 0)
  const result = await pool.query(
    `${SELECT_GENERATION}
      WHERE g.user_id = $1 AND g.deleted_at IS NULL AND g.file_id IS NOT NULL
      ORDER BY g.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  )
  const lifetime = await lifetimeCost(userId)
  const fileIds = result.rows
    .map((row) => (row as GenerationRow).file_id)
    .filter((id): id is string => typeof id === "string")
  const variants = await listFileVariants(fileIds)
  return {
    images: result.rows.map((row) =>
      mapGenerationRow(
        row as GenerationRow,
        lifetime.rates.get(mxDayKey((row as GenerationRow).created_at)) ?? null,
        variants
      )
    ),
    total: Number(totalResult.rows[0].count),
    totalCostUsd: lifetime.totalUsd,
    totalCostMxn: lifetime.totalMxn,
    fx: lifetime.latest,
  }
}

/*
 * Soft delete: the image leaves the gallery and its binary is removed, but the
 * spend record stays so the accumulated cost keeps matching provider billing.
 */
export async function deleteImageGeneration(
  userId: string,
  generationId: string
): Promise<boolean> {
  if (!UUID_RE.test(generationId)) return false
  // Read file_id before nulling it: UPDATE ... RETURNING yields the new value.
  const found = await pool.query(
    `SELECT file_id FROM image_generations
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [generationId, userId]
  )
  if (!found.rowCount) return false
  const fileId = found.rows[0].file_id as string | null
  await pool.query(
    `UPDATE image_generations
        SET deleted_at = now(), file_id = NULL
      WHERE id = $1`,
    [generationId]
  )
  if (fileId) await deleteUserFile(userId, fileId).catch(() => {})
  return true
}

/*
 * "Insertar detalles": the model reads the user's request, researches it on
 * the web (Tavily), confirms each fact with at least two independent
 * sources and returns a single prompt that already carries the verified
 * data, plus the aspect ratio implied by the text (retrato, banner,
 * paisaje, logo...).
 */

export interface EnhancePromptInput {
  prompt: string
  aspectRatio?: AspectRatio
  /** Ids de los adjuntos del usuario que sirven de imagen de referencia. */
  referenceIds?: readonly string[]
}

export interface EnhancePromptResult {
  prompt: string
  aspectRatio: AspectRatio
  /** Aviso para el usuario cuando la petición se apoya en un hecho que no
   * ocurrió: viaja fuera del prompt para no contaminarlo. */
  note: string | null
  /** Fuentes que respaldan los datos confirmados (dos o más por dato). */
  sources: DetailsSource[]
  /** Datos confirmados con al menos dos fuentes independientes. */
  facts: DetailsFact[]
}

export async function enhanceImagePrompt(
  userId: string,
  input: EnhancePromptInput
): Promise<EnhancePromptResult> {
  // Las referencias se resuelven antes de llamar al proveedor: un adjunto
  // inválido debe fallar sin gastarle nada al usuario.
  const referenceImages = await resolveReferenceImages(
    userId,
    input.referenceIds ?? []
  )

  const detailsInput: PromptDetailsInput = {
    prompt: input.prompt,
    aspectRatio: input.aspectRatio ?? "auto",
    referenceImages,
  }

  const toResult = (details: PromptDetailsResult): EnhancePromptResult => ({
    prompt: details.prompt,
    aspectRatio: isAspectRatio(details.aspectRatio)
      ? details.aspectRatio
      : (input.aspectRatio ?? "auto"),
    note: details.note,
    sources: details.sources,
    facts: details.facts,
  })

  // Ruta rápida: una sola llamada a Gemini con Google Search grounding
  // (busca dentro del modelo; ~un tercio del tiempo del pipeline completo).
  // Si falla (timeout, JSON inválido, error del proveedor), cae al pipeline
  // de respaldo sin que el usuario note nada. Cuando la búsqueda corrió, su
  // costo estimado se acumula para prorratearlo a la próxima generación.
  if (groundingConfigured()) {
    try {
      const grounding = await buildPromptWithGrounding(detailsInput)
      if (grounding.searched && grounding.costUsd !== null) {
        accrueDetailsCost(userId, grounding.costUsd)
      }
      return toResult(grounding.details)
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: grounding fast path failed, cayendo al pipeline de respaldo: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  }

  return toResult(await buildPromptWithDetails(detailsInput))
}
