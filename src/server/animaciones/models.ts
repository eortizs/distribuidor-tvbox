import type { ModelMessage } from "ai"

/**
 * Catálogo de LLMs del agente de animación.
 *
 * Los niveles de razonamiento, ventanas de contexto y topes de salida son los
 * que reporta el catálogo del Vercel AI Gateway
 * (GET https://ai-gateway.vercel.sh/v1/models, campo `reasoning_options` y
 * `supported_parameters`, consultado el 2026-10-20). El nivel máximo de cada
 * modelo se envía explícito en cada llamada: el AI SDK lo reenvía tal cual al
 * gateway (incluido `"max"`, que eve no acepta a nivel de agente).
 */

export type GatewayReasoningLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"

export interface AnimationModelInfo {
  /** ID del modelo en el AI Gateway (`provider/model`). */
  readonly id: string
  /** Nombre corto para el selector de la UI. */
  readonly label: string
  /** Proveedor que lo sirve, para la UI. */
  readonly provider: string
  /** Ventana de contexto declarada por el catálogo del gateway. */
  readonly contextWindowTokens: number
  /** Tope de salida declarado por el catálogo del gateway. */
  readonly maxOutputTokens: number
  /** Esfuerzos de razonamiento que reporta el catálogo del gateway. */
  readonly reasoningLevels: readonly GatewayReasoningLevel[]
  /** Nivel máximo reportado; se fija explícito en cada llamada del agente. */
  readonly maxReasoningLevel: GatewayReasoningLevel
}

/**
 * Modelos disponibles para el selector. `ANIMATION_MODELS` (en `.env`) decide
 * el orden y el subconjunto; los IDs desconocidos se ignoran porque no
 * tendrían nivel de razonamiento verificado contra el catálogo.
 */
const REGISTRY: readonly AnimationModelInfo[] = [
  {
    id: "minimax/minimax-m3.1-flash",
    label: "MiniMax M3.1 Flash",
    provider: "MiniMax",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 524_288,
    reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    maxReasoningLevel: "max",
  },
  {
    id: "xiaomi/mimo-v2.6-pro",
    label: "MiMo V2.6 Pro",
    provider: "Xiaomi",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 131_072,
    reasoningLevels: ["none", "minimal", "low", "medium", "high"],
    maxReasoningLevel: "high",
  },
  {
    id: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5",
    provider: "Anthropic",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    maxReasoningLevel: "max",
  },
  {
    id: "deepseek/deepseek-v4.1-flash-1017",
    label: "DeepSeek V4.1 Flash",
    provider: "DeepSeek",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 1_048_576,
    reasoningLevels: ["none", "low", "high", "max"],
    maxReasoningLevel: "max",
  },
  {
    id: "openai/gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    provider: "OpenAI",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    maxReasoningLevel: "max",
  },
]

const REGISTRY_BY_ID: ReadonlyMap<string, AnimationModelInfo> = new Map(
  REGISTRY.map((model) => [model.id, model])
)

/** Modelos seleccionables, en el orden de `ANIMATION_MODELS`. */
export function animationModels(): readonly AnimationModelInfo[] {
  const raw = process.env.ANIMATION_MODELS
  if (!raw?.trim()) return REGISTRY
  const selected = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => REGISTRY_BY_ID.get(id))
    .filter((model): model is AnimationModelInfo => model !== undefined)
  return selected.length > 0 ? selected : REGISTRY
}

export function findAnimationModel(id: string): AnimationModelInfo | undefined {
  return REGISTRY_BY_ID.get(id)
}

/**
 * Sentinela que viaja como clientContext de cada turno (`modelo-seleccionado:
 * <id>`). El contexto de cliente llega al resolver dinámico de modelo como
 * mensaje user-role efímero y no se persiste en el historial durable.
 */
export const MODEL_SELECTOR_PREFIX = "modelo-seleccionado:"

const MODEL_SELECTOR_RE =
  /^[ \t]*modelo-seleccionado:[ \t]*([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)[ \t]*$/im

function messageText(message: ModelMessage): string {
  const content = message.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
  }
  return ""
}

/** Extrae el modelo elegido del contexto de cliente visible en los mensajes. */
export function animationModelIdFromMessages(
  messages: readonly ModelMessage[]
): string | null {
  let found: string | null = null
  for (const message of messages) {
    if (message.role !== "user") continue
    const match = MODEL_SELECTOR_RE.exec(messageText(message))
    if (match) found = match[1]
  }
  return found
}

/**
 * Nivel de razonamiento que eve acepta a nivel de agente (eve no admite
 * `"max"`): el máximo del catálogo que quepa en la unión de eve.
 */
export function eveReasoningLevel(
  level: GatewayReasoningLevel
): Exclude<GatewayReasoningLevel, "max"> {
  return level === "max" ? "xhigh" : level
}
