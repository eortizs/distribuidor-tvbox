/**
 * Catálogo de modelos de imagen de la herramienta Imágenes.
 *
 * Los IDs, las calidades, los tamaños y las relaciones de aspecto están
 * verificados contra el Vercel AI Gateway (catálogo + pruebas en vivo del
 * 2026-10-21). Cada familia de proveedor expone los controles de forma
 * distinta, así que el catálogo declara las capacidades de cada modelo y la
 * UI se adapta a ellas.
 */

/** Calidad de render que se envía al gateway. */
export type ImageRenderQuality = "auto" | "low" | "medium" | "high"

/**
 * Cómo se controla el tamaño de salida:
 * - `pixels`: el tamaño en píxeles (`size: "1024x1024"`), que implica el
 *   aspecto (los modelos de OpenAI no aceptan `aspectRatio`).
 * - `tier`: el nivel de resolución (`imageConfig.imageSize`: 512, 1K, 2K, 4K)
 *   y el aspecto va aparte (Gemini).
 * - `none`: el modelo no controla el tamaño (solo el aspecto).
 */
export type ImageSizeMode = "pixels" | "tier" | "none"

/** Tipo de modelo en el gateway: imagen o LLM multimodal que devuelve imágenes. */
export type ImageModelKind = "image" | "language"

export interface ImageModelInfo {
  /** ID del modelo en el AI Gateway (`provider/model`). */
  readonly id: string
  /** Nombre corto para la UI. */
  readonly label: string
  /** Proveedor que lo sirve, para la UI. */
  readonly provider: string
  /** Endpoint con el que se llama al modelo. */
  readonly kind: ImageModelKind
  /** Clave de `providerOptions` que el gateway enruta al proveedor final. */
  readonly providerKey: string
  /** Cómo se controla el tamaño de salida. */
  readonly sizeMode: ImageSizeMode
  /** Tamaños admitidos (píxeles o nivel de resolución, según `sizeMode`). */
  readonly sizes: readonly string[]
  /** Relaciones de aspecto admitidas. */
  readonly aspects: readonly string[]
  /** Calidades admitidas (vacío: el modelo no expone calidad). */
  readonly qualities: readonly ImageRenderQuality[]
}

export interface ImageSizeOption {
  /** Valor que se envía al gateway. */
  readonly value: string
  /** Etiqueta para la UI. */
  readonly label: string
  /** Relación de aspecto equivalente (solo en los tamaños en píxeles). */
  readonly aspect?: string
}

/** Tamaños en píxeles (modelos tipo OpenAI): el tamaño implica el aspecto. */
export const PIXEL_SIZES: readonly ImageSizeOption[] = [
  { value: "auto", label: "Automático · lo decide el modelo" },
  { value: "1024x1024", label: "1024×1024 · 1:1 Cuadrada", aspect: "1:1" },
  { value: "1792x1008", label: "1792×1008 · 16:9 Panorámica", aspect: "16:9" },
  { value: "1008x1792", label: "1008×1792 · 9:16 Vertical", aspect: "9:16" },
  { value: "1024x768", label: "1024×768 · 4:3 Clásica", aspect: "4:3" },
  { value: "768x1024", label: "768×1024 · 3:4 Retrato", aspect: "3:4" },
  { value: "1536x1024", label: "1536×1024 · 3:2 Foto", aspect: "3:2" },
  { value: "1024x1536", label: "1024×1536 · 2:3 Foto vertical", aspect: "2:3" },
]

/** Niveles de resolución (modelos tipo Gemini). */
export const TIER_SIZES: readonly ImageSizeOption[] = [
  { value: "512", label: "512 px · Ligera" },
  { value: "1K", label: "1K px · Estándar" },
  { value: "2K", label: "2K px · Alta" },
  { value: "4K", label: "4K px · Máxima" },
]

/**
 * Lista de relaciones de aspecto de la UI: la misma para todos los niveles
 * (el modelo decide cómo se aplica). Cada una lleva su título.
 */
export const ASPECT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "1:1", label: "1:1 · Cuadrada" },
  { value: "16:9", label: "16:9 · Panorámica" },
  { value: "9:16", label: "9:16 · Vertical" },
  { value: "4:3", label: "4:3 · Clásica" },
  { value: "3:4", label: "3:4 · Retrato" },
  { value: "3:2", label: "3:2 · Foto" },
  { value: "2:3", label: "2:3 · Foto vertical" },
]

/** Aspectos que acepta Gemini (el juego estándar de la API). */
const GEMINI_ASPECTS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const

/** Aspectos verificados de Grok Imagine (otros se resuelven a 16:9). */
const GROK_ASPECTS = ["1:1", "16:9", "4:3"] as const

/** Aspectos que se deducen del tamaño en píxeles. */
const PIXEL_ASPECTS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const

/**
 * Modelos disponibles. `IMAGE_MODELS` (en `.env`) decide el orden y el
 * subconjunto que se usa por omisión; los IDs desconocidos se ignoran
 * porque no están verificados contra el catálogo del gateway.
 */
const REGISTRY: readonly ImageModelInfo[] = [
  {
    id: "google/gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash Lite Image",
    provider: "Google",
    kind: "language",
    providerKey: "google",
    sizeMode: "tier",
    sizes: ["1K"],
    aspects: GEMINI_ASPECTS,
    qualities: [],
  },
  {
    id: "spacexai/grok-imagine-image-2.0",
    label: "Grok Imagine 2.0",
    provider: "xAI",
    kind: "image",
    providerKey: "xai",
    sizeMode: "none",
    sizes: [],
    aspects: GROK_ASPECTS,
    qualities: ["auto", "low", "medium"],
  },
  {
    id: "google/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    provider: "Google",
    kind: "language",
    providerKey: "google",
    sizeMode: "tier",
    sizes: ["512", "1K", "2K", "4K"],
    aspects: GEMINI_ASPECTS,
    qualities: [],
  },
  {
    id: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    provider: "OpenAI",
    kind: "image",
    providerKey: "openai",
    sizeMode: "pixels",
    sizes: PIXEL_SIZES.map((size) => size.value),
    aspects: PIXEL_ASPECTS,
    qualities: ["auto", "low", "medium", "high"],
  },
]

const REGISTRY_BY_ID: ReadonlyMap<string, ImageModelInfo> = new Map(
  REGISTRY.map((model) => [model.id, model])
)

/** Todos los modelos verificados, para el selector de configuración. */
export function allImageModels(): readonly ImageModelInfo[] {
  return REGISTRY
}

/** Modelos seleccionables por omisión, en el orden de `IMAGE_MODELS`. */
export function imageModels(): readonly ImageModelInfo[] {
  const raw = process.env.IMAGE_MODELS
  if (!raw?.trim()) return REGISTRY
  const selected = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => REGISTRY_BY_ID.get(id))
    .filter((model): model is ImageModelInfo => model !== undefined)
  return selected.length > 0 ? selected : REGISTRY
}

export function findImageModel(id: string): ImageModelInfo | undefined {
  return REGISTRY_BY_ID.get(id)
}

/** Opciones de tamaño que ofrece un modelo. */
export function sizeOptionsFor(model: ImageModelInfo): readonly ImageSizeOption[] {
  if (model.sizeMode === "pixels") {
    return PIXEL_SIZES.filter((option) => model.sizes.includes(option.value))
  }
  if (model.sizeMode === "tier") {
    return TIER_SIZES.filter((option) => model.sizes.includes(option.value))
  }
  return []
}

/**
 * Tamaño por omisión de un modelo: el estándar de su familia (1K en los
 * niveles de resolución, 1024x1024 en los de píxeles) y, si no lo admite,
 * el primero disponible.
 */
export function defaultSizeFor(model: ImageModelInfo): string | null {
  const options = sizeOptionsFor(model)
  const preferred =
    model.sizeMode === "tier" ? "1K" : model.sizeMode === "pixels" ? "1024x1024" : null
  if (preferred && options.some((option) => option.value === preferred)) {
    return preferred
  }
  return options[0]?.value ?? null
}

/**
 * Calidad por omisión de un modelo: la máxima que admite (los modelos de
 * OpenAI llegan a `high`; Grok solo llega a `medium`).
 */
export function defaultQualityFor(
  model: ImageModelInfo
): ImageRenderQuality | null {
  return model.qualities.length > 0
    ? model.qualities[model.qualities.length - 1]
    : null
}

/** `true` si el modelo admite ese tamaño. */
export function supportsSize(model: ImageModelInfo, size: string): boolean {
  return model.sizes.includes(size)
}

/** `true` si el modelo admite esa calidad. */
export function supportsQuality(
  model: ImageModelInfo,
  quality: string
): boolean {
  return (model.qualities as readonly string[]).includes(quality)
}

/** Tamaño en píxeles que corresponde a una relación de aspecto. */
export function pixelSizeForAspect(aspect: string): string | undefined {
  return PIXEL_SIZES.find((option) => option.aspect === aspect)?.value
}

/**
 * Niveles del control de calidad. Cada nivel corresponde a un par de
 * modelos de `IMAGE_MODELS` (`.env`): el primero es el principal y el
 * segundo el respaldo que se usa si el principal falla.
 */
export const QUALITY_STEPS = [
  { id: "media", label: "Media" },
  { id: "alta", label: "Alta" },
] as const

export type QualityStepId = (typeof QUALITY_STEPS)[number]["id"]
export type QualityStepLabel = (typeof QUALITY_STEPS)[number]["label"]

/** El modelo de un nivel, con su calidad y su tamaño. */
export interface ImageModelEntry {
  readonly model: ImageModelInfo
  /** Calidad de render (null si el modelo no expone calidad). */
  readonly quality: ImageRenderQuality | null
  /** Tamaño de salida (null si el modelo no lo controla). */
  readonly size: string | null
}

/** Un nivel del control de calidad: un único modelo. */
export interface ImageLevel {
  readonly id: QualityStepId
  readonly label: QualityStepLabel
  /** Modelo del nivel con su calidad y su tamaño. */
  readonly entry: ImageModelEntry
}

/** Modelos por nivel que se usan por omisión (los de `IMAGE_MODELS`). */
export function defaultImageLevels(): readonly ImageLevel[] {
  const models = imageModels()
  return QUALITY_STEPS.map((step, index) => {
    const model = models[index]
    if (!model) return null
    return {
      id: step.id,
      label: step.label,
      entry: {
        model,
        quality: defaultQualityFor(model),
        size: defaultSizeFor(model),
      },
    }
  }).filter((level): level is ImageLevel => level !== null)
}

/** Relaciones de aspecto que admite el modelo del nivel. */
export function levelAspects(level: ImageLevel): readonly string[] {
  return level.entry.model.aspects
}

/** Proporción numérica de una relación de aspecto ("16:9" → 1.777…). */
function aspectRatioValue(aspect: string): number | null {
  const [width, height] = aspect.split(":")
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null
  return w / h
}

/**
 * Aspecto que realmente se manda al proveedor: si el modelo no admite el
 * pedido, se usa el más cercano entre los que sí admite (así la imagen no
 * sale con una forma distinta sin avisar).
 */
export function closestAspect(
  model: ImageModelInfo,
  aspect: string
): string | undefined {
  if (model.aspects.includes(aspect)) return aspect
  const target = aspectRatioValue(aspect)
  if (target === null) return model.aspects[0]
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of model.aspects) {
    const value = aspectRatioValue(candidate)
    if (value === null) continue
    const distance = Math.abs(Math.log(value / target))
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best ?? model.aspects[0]
}
