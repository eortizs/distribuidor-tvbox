import { pool } from "@/server/db"
import {
  deleteUserFile,
  maxUploadBytes,
  saveUserFile,
  type UserFile,
} from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images"

const MAX_PROMPT_LENGTH = 2000
const REQUEST_TIMEOUT_MS = 180_000

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
export const QUALITIES = ["auto", "low", "medium", "high"] as const

export type AspectRatio = (typeof ASPECT_RATIOS)[number]
export type Quality = (typeof QUALITIES)[number]

export interface ImageFilePayload {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
}

export interface ImageGenerationPayload {
  id: string
  prompt: string
  model: string
  aspectRatio: string | null
  quality: string | null
  costUsd: number | null
  createdAt: string
  file: ImageFilePayload | null
}

export interface GenerateImageInput {
  prompt: string
  aspectRatio?: AspectRatio
  quality?: Quality
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

function isQuality(value: unknown): value is Quality {
  return (
    typeof value === "string" && (QUALITIES as readonly string[]).includes(value)
  )
}

export function sanitizeImageInput(input: unknown):
  | {
      ok: true
      prompt: string
      aspectRatio?: AspectRatio
      quality?: Quality
    }
  | { ok: false } {
  if (typeof input !== "object" || input === null) return { ok: false }
  const { prompt, aspectRatio, quality } = input as Record<string, unknown>
  if (typeof prompt !== "string") return { ok: false }
  const trimmed = prompt.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PROMPT_LENGTH) {
    return { ok: false }
  }
  if (aspectRatio !== undefined && !isAspectRatio(aspectRatio)) {
    return { ok: false }
  }
  if (quality !== undefined && !isQuality(quality)) return { ok: false }
  return {
    ok: true,
    prompt: trimmed,
    aspectRatio: isAspectRatio(aspectRatio) ? aspectRatio : undefined,
    quality: isQuality(quality) ? quality : undefined,
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

function mapGenerationRow(row: GenerationRow): ImageGenerationPayload {
  const file =
    row.file_id && row.file_name && row.mime_type
      ? {
          id: row.file_id,
          fileName: row.file_name,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes ?? 0),
          url: `/api/files/${row.file_id}`,
        }
      : null
  return {
    id: row.id,
    prompt: row.prompt,
    model: row.model,
    aspectRatio: row.aspect_ratio,
    quality: row.quality,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
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

/** Lifetime provider spend: soft-deleted generations still cost money. */
export async function totalCostUsd(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
       FROM image_generations
      WHERE user_id = $1`,
    [userId]
  )
  return Number(result.rows[0].total)
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
  costUsd: number | null
): Promise<void> {
  await pool
    .query(
      `INSERT INTO image_generations (id, user_id, file_id, prompt, model, aspect_ratio, quality, cost_usd)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
      [crypto.randomUUID(), userId, prompt, model, aspectRatio, quality, costUsd]
    )
    .catch(() => {})
}

export async function generateImage(
  userId: string,
  input: GenerateImageInput
): Promise<{ image: ImageGenerationPayload; totalCostUsd: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.IMAGE_MODEL
  if (!apiKey || !model) {
    throw new AppError(
      500,
      "image_provider_not_configured",
      "La generación de imágenes no está configurada en el servidor (falta OPENROUTER_API_KEY o IMAGE_MODEL)."
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        n: 1,
        ...(input.aspectRatio && input.aspectRatio !== "auto"
          ? { aspect_ratio: input.aspectRatio }
          : {}),
        ...(input.quality && input.quality !== "auto"
          ? { quality: input.quality }
          : {}),
      }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AppError(
        504,
        "image_provider_timeout",
        "El proveedor del modelo tardó demasiado en generar la imagen. Inténtalo de nuevo."
      )
    }
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: openrouter fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    )
    throw new AppError(
      502,
      "image_provider_unreachable",
      "No pude conectarme con el proveedor del modelo. Inténtalo de nuevo en unos momentos."
    )
  }

  if (!upstream.ok) {
    const status = upstream.status
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: openrouter ${status}`,
      })
    )
    const message =
      status === 401 || status === 403
        ? "El servidor no está autorizado frente al proveedor del modelo (revisa OPENROUTER_API_KEY)."
        : status === 429
          ? "El proveedor del modelo está saturado. Inténtalo de nuevo en unos momentos."
          : "El proveedor del modelo no pudo generar la imagen. Ajusta el prompt e inténtalo de nuevo."
    throw new AppError(status === 429 ? 429 : 502, "image_provider_error", message)
  }

  const payload = (await upstream.json().catch(() => null)) as {
    data?: { b64_json?: string; media_type?: string }[]
    usage?: { cost?: number }
  } | null
  const item = payload?.data?.[0]
  if (!item?.b64_json) {
    throw new AppError(
      502,
      "image_provider_error",
      "El proveedor no devolvió ninguna imagen. Inténtalo de nuevo."
    )
  }

  const mimeType =
    typeof item.media_type === "string" && item.media_type.startsWith("image/")
      ? item.media_type
      : "image/png"
  const bytes = Uint8Array.from(Buffer.from(item.b64_json, "base64"))
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

  // The provider bills completed generations in full: resolve the user's
  // running total before persisting anything, so a later failure can never
  // leave a stored file or row without a total to report against.
  const costUsd =
    typeof payload?.usage?.cost === "number" && Number.isFinite(payload.usage.cost)
      ? payload.usage.cost
      : null
  const totalBefore = await totalCostUsd(userId)

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
      input.aspectRatio ?? null,
      input.quality ?? null,
      costUsd
    )
    throw error
  }

  try {
    const result = await pool.query(
      `INSERT INTO image_generations (id, user_id, file_id, prompt, model, aspect_ratio, quality, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, file_id, prompt, model, aspect_ratio, quality, cost_usd, created_at,
                 $9 AS file_name, $10 AS mime_type, $11 AS size_bytes`,
      [
        crypto.randomUUID(),
        userId,
        saved.id,
        input.prompt,
        model,
        input.aspectRatio ?? null,
        input.quality ?? null,
        costUsd,
        saved.fileName,
        saved.mimeType,
        saved.sizeBytes,
      ]
    )
    // Durable from here: the generation row (and its cost) is committed, so
    // no later failure may delete the paid binary.
    const image = mapGenerationRow(result.rows[0] as GenerationRow)
    return {
      image,
      totalCostUsd: totalBefore + (costUsd ?? 0),
    }
  } catch (error) {
    await recordCostOnly(
      userId,
      input.prompt,
      model,
      input.aspectRatio ?? null,
      input.quality ?? null,
      costUsd
    )
    await deleteUserFile(userId, saved.id).catch(() => {})
    throw error
  }
}

export async function listImageGenerations(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ images: ImageGenerationPayload[]; total: number; totalCostUsd: number }> {
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
  return {
    images: result.rows.map((row) => mapGenerationRow(row as GenerationRow)),
    total: Number(totalResult.rows[0].count),
    totalCostUsd: await totalCostUsd(userId),
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * LLM prompt enhancement ("Mejorar instrucciones"): the text model rewrites
 * the user's prompt to be concrete and visual, and resolves an aspect ratio
 * that is ambiguous in the text (retrato, banner, paisaje, logo...).
 */

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
const ENHANCE_TIMEOUT_MS = 30_000
// max_tokens includes the model's internal reasoning (muse-spark spends
// hundreds of tokens thinking before the JSON answer).
const ENHANCE_MAX_OUTPUT_TOKENS = 2000

const ENHANCE_SYSTEM_PROMPT = [
  "Eres el asistente de prompts de la herramienta de generación de imágenes del panel.",
  "Reescribes el prompt del usuario para que sea claro, visual y específico: mantiene su intención e idioma (español), no inventa elementos que contradigan lo pedido y añade solo cuando falten detalles útiles de estilo, iluminación, composición y encuadre. Máximo 80 palabras.",
  "Si el prompt implica claramente una relación de aspecto (p. ej. 'banner' o 'paisaje' → 16:9, 'retrato' o 'historia' → 9:16, 'logo' o 'icono' → 1:1), sugiere la adecuada; si no, conserva la seleccionada.",
  "La calidad solo cambia si el usuario lo pide explícitamente ('alta calidad', 'borrador rápido'); si no, conserva la seleccionada.",
  'Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones: {"prompt": string, "aspectRatio": "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3", "quality": "auto" | "low" | "medium" | "high"}',
].join(" ")

export interface EnhancePromptInput {
  prompt: string
  aspectRatio?: AspectRatio
  quality?: Quality
}

export interface EnhancePromptResult {
  prompt: string
  aspectRatio: AspectRatio
  quality: Quality
}

function parseEnhanceResponse(
  raw: string,
  fallback: EnhancePromptInput
): EnhancePromptResult | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    // Tolerate prose around the JSON: grab the first balanced {...} block.
    const match = stripped.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return null
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { prompt, aspectRatio, quality } = parsed as Record<string, unknown>
  if (typeof prompt !== "string") return null
  const trimmed = prompt.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PROMPT_LENGTH) return null
  return {
    prompt: trimmed,
    aspectRatio: isAspectRatio(aspectRatio)
      ? aspectRatio
      : (fallback.aspectRatio ?? "auto"),
    quality: isQuality(quality) ? quality : (fallback.quality ?? "auto"),
  }
}

export async function enhanceImagePrompt(
  input: EnhancePromptInput
): Promise<EnhancePromptResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.ASISTENTE_MODEL
  if (!apiKey || !model) {
    throw new AppError(
      500,
      "enhance_not_configured",
      "La mejora de instrucciones no está configurada en el servidor (falta OPENROUTER_API_KEY o ASISTENTE_MODEL)."
    )
  }

  const userContent = [
    `Prompt actual: ${input.prompt}`,
    `Aspecto seleccionado: ${input.aspectRatio ?? "auto"}`,
    `Calidad seleccionada: ${input.quality ?? "auto"}`,
  ].join("\n")

  let upstream: Response
  try {
    upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(ENHANCE_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: ENHANCE_MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: ENHANCE_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AppError(
        504,
        "enhance_timeout",
        "El modelo tardó demasiado en revisar las instrucciones. Inténtalo de nuevo."
      )
    }
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: enhance fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    )
    throw new AppError(
      502,
      "enhance_unreachable",
      "No pude conectarme con el modelo. Inténtalo de nuevo en unos momentos."
    )
  }

  if (!upstream.ok) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: enhance openrouter ${upstream.status}`,
      })
    )
    throw new AppError(
      502,
      "enhance_error",
      "El modelo no pudo revisar las instrucciones. Inténtalo de nuevo en unos momentos."
    )
  }

  const payload = (await upstream.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null } }[]
  } | null
  const raw = payload?.choices?.[0]?.message?.content
  if (!raw) {
    throw new AppError(
      502,
      "enhance_error",
      "El modelo no devolvió ninguna propuesta. Inténtalo de nuevo."
    )
  }
  const result = parseEnhanceResponse(raw, input)
  if (!result) {
    throw new AppError(
      502,
      "enhance_error",
      "La propuesta del modelo no fue válida. Inténtalo de nuevo."
    )
  }
  return result
}
