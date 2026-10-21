import { pool } from "@/server/db"
import {
  QUALITY_STEPS,
  defaultImageLevels,
  defaultQualityFor,
  defaultSizeFor,
  findImageModel,
  supportsQuality,
  supportsSize,
  type ImageLevel,
  type ImageRenderQuality,
  type QualityStepId,
} from "@/server/images/models"

/** La configuración de un nivel: modelo, calidad y tamaño. */
export interface ImageLevelConfig {
  model: string
  /** Calidad de render (null si el modelo no expone calidad). */
  quality: ImageRenderQuality | null
  /** Tamaño de salida (null si el modelo no lo controla). */
  size: string | null
}

export type ImageLevelConfigs = Record<QualityStepId, ImageLevelConfig>

/** Columna JSONB donde vive la configuración. */
const LEVELS_COLUMN = "image_levels"

const RENDER_QUALITIES: readonly ImageRenderQuality[] = [
  "auto",
  "low",
  "medium",
  "high",
]

export function isRenderQuality(value: unknown): value is ImageRenderQuality {
  return (
    typeof value === "string" &&
    (RENDER_QUALITIES as readonly string[]).includes(value)
  )
}

/**
 * Normaliza la configuración de un nivel contra el catálogo: si el modelo ya
 * no existe, o la calidad o el tamaño no los admite, se corrige con los
 * valores válidos del modelo. Acepta el formato antiguo (una lista de
 * modelos por nivel) y se queda con el primero.
 */
function normalizeEntry(raw: unknown): ImageLevelConfig | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== "object" || value === null) return null
  const { model: modelId, quality, size } = value as Record<string, unknown>
  const model = typeof modelId === "string" ? findImageModel(modelId) : undefined
  if (!model) return null

  return {
    model: model.id,
    quality:
      typeof quality === "string" && supportsQuality(model, quality)
        ? (quality as ImageRenderQuality)
        : defaultQualityFor(model),
    size:
      typeof size === "string" && supportsSize(model, size)
        ? size
        : defaultSizeFor(model),
  }
}

/**
 * Niveles configurados por el usuario.
 *
 * Sin fila en `user_settings` (o con una entrada inválida) se usa la
 * omisión: los modelos de `IMAGE_MODELS` (`.env`), uno por nivel, con la
 * máxima calidad y el tamaño estándar de cada modelo.
 */
export async function getImageLevels(userId: string): Promise<ImageLevel[]> {
  const defaults = defaultImageLevels()
  const result = await pool.query(
    `SELECT ${LEVELS_COLUMN} FROM user_settings WHERE user_id = $1`,
    [userId]
  )
  const stored = (result.rows[0]?.[LEVELS_COLUMN] ?? null) as Record<
    string,
    unknown
  > | null

  const levels: ImageLevel[] = []
  for (const step of QUALITY_STEPS) {
    const fallbackLevel = defaults.find((level) => level.id === step.id)
    const config = normalizeEntry(stored?.[step.id])
    if (!config) {
      if (fallbackLevel) levels.push(fallbackLevel)
      continue
    }
    const model = findImageModel(config.model)
    if (!model) {
      if (fallbackLevel) levels.push(fallbackLevel)
      continue
    }
    levels.push({
      id: step.id,
      label: step.label,
      entry: {
        model,
        quality: config.quality,
        size: config.size,
      },
    })
  }
  return levels
}

/**
 * Configuración editable de los niveles: lo que el usuario tiene guardado,
 * con la omisión ya resuelta.
 */
export async function getImageLevelConfigs(
  userId: string
): Promise<ImageLevelConfigs> {
  const levels = await getImageLevels(userId)
  const byId = new Map(levels.map((level) => [level.id, level]))
  const configs = {} as ImageLevelConfigs
  for (const step of QUALITY_STEPS) {
    const level = byId.get(step.id)
    configs[step.id] = {
      model: level?.entry.model.id ?? "",
      quality: level?.entry.quality ?? null,
      size: level?.entry.size ?? null,
    }
  }
  return configs
}

/** Guarda la configuración de los niveles del usuario (una fila por usuario). */
export async function saveImageLevels(
  userId: string,
  configs: ImageLevelConfigs
): Promise<void> {
  const payload = {
    media: configs.media,
    alta: configs.alta,
  }
  await pool.query(
    `INSERT INTO user_settings (user_id, ${LEVELS_COLUMN}, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
        SET ${LEVELS_COLUMN} = EXCLUDED.${LEVELS_COLUMN},
            updated_at = now()`,
    [userId, JSON.stringify(payload)]
  )
}
