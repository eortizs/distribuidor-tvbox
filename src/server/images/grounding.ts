import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

import {
  type DetailsSource,
  type MexicoCityMoment,
  type PromptDetailsResult,
  mexicoCityNow,
  normalizeUrl,
  parseDetailsResponse,
  validateFacts,
} from "@/server/images/details"

/**
 * Ruta rápida de "Insertar detalles": una sola llamada a Gemini con Google
 * Search grounding (la búsqueda corre dentro del modelo, en la
 * infraestructura de Google) en vez del pipeline plan → Tavily → síntesis.
 *
 * - El modelo decide si busca y con qué queries; no hay etapa de planificación.
 * - Esta API no devuelve groundingChunks (metadata de grounding en null):
 *   las fuentes disponibles son las URLs que cita el propio modelo tras
 *   buscar. El servidor conserva la regla de dos familias editoriales
 *   distintas por dato y deduplica las fuentes; la verificación contra un
 *   índice de resultados reales ya no es posible por esta vía.
 * - Sin fechas de publicación: la frescura de los datos volátiles queda
 *   declarativa (el modelo cita el corte temporal en el valor del dato).
 * - Si la llamada falla o falta la API key, el service cae al pipeline de
 *   respaldo: esta ruta nunca rompe el botón.
 *
 * Requiere GEMINI_API_KEY (o GOOGLE_GENERATIVE_AI_API_KEY) en `.env`.
 */

const GROUNDING_TIMEOUT_MS = 45_000
const GROUNDING_MAX_OUTPUT_TOKENS = 4_000
const DEFAULT_GROUNDING_MODEL = "gemini-3.8-flash"

function groundingApiKey(): string | undefined {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
  return key && key.length > 0 ? key : undefined
}

export function groundingConfigured(): boolean {
  return groundingApiKey() !== undefined
}

function resolveGroundingModel(): string {
  const dedicated = process.env.IMAGE_DETAILS_GROUNDING_MODEL?.trim()
  if (dedicated && dedicated.length > 0) return dedicated
  // IMAGE_DETAILS_MODEL con prefijo google/ (p. ej. "google/gemini-3.8-flash")
  // nombra el mismo modelo para la API directa de Google.
  const details = process.env.IMAGE_DETAILS_MODEL?.trim()
  if (details && details.startsWith("google/")) return details.slice("google/".length)
  return DEFAULT_GROUNDING_MODEL
}

/** Presupuesto de razonamiento (tokens de thinking): 0 = máxima velocidad. */
function resolveThinkingBudget(): number {
  const raw = Number(process.env.IMAGE_DETAILS_GROUNDING_THINKING?.trim())
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0
}

function groundingSystemPrompt(moment: MexicoCityMoment): string {
  return [
    "Eres el director de arte de la herramienta de imágenes del panel de Distribuidor TVBox.",
    `Referencia temporal: ahora en Ciudad de México (${moment.offsetLabel}) es ${moment.long}, ${moment.time} (fecha ISO: ${moment.iso}). Resuelve referencias como "hoy", "esta noche" o "el próximo partido" con esa fecha y con lo que devuelva la búsqueda.`,
    "Maneja los horarios exclusivamente en hora del centro de México (Ciudad de México). Traduce a esa zona cualquier hora que encuentres y no agregues la zona ni la hora local de origen: escribe solo la hora de Ciudad de México (por ejemplo, \"19:00\"), sin \"hora local\", sin \"GMT\" y sin nombrar la ciudad de origen.",
    "Todo lo que escribas va siempre en español de México (es-MX), sin excepción, incluido el campo \"prompt\": si la petición del usuario está en inglés u otro idioma, tradúcela al español de México. Usa el léxico y las referencias propias de México (\"El Tri\", \"la Selección Mexicana\", \"liga MX\"), nunca otra variante regional del español ni otro idioma.",
    'Si la petición depende de datos externos concretos y verificables (eventos deportivos o de espectáculos, partidos, fechas, horarios, resultados, clasificaciones, cifras, precios, nombres propios actuales), usa la herramienta google_search para verificarlos con la información más reciente; busca en español y anclado a México cuando el tema lo permita. No la uses si todo sale de la imaginación o del conocimiento estable (personajes ficticios, paisajes, logos, ilustraciones).',
    'Cada dato confirmado que integres al prompt va en "facts" con 2 o 3 URLs exactas de los resultados de búsqueda que lo respaldan, de medios distintos (dos páginas del mismo medio cuentan como una sola fuente; espn.com.mx y espndeportes.com son ESPN). Un dato que solo una fuente respalde no se confirma: no lo integres, no lo estimes y no lo inventes; si conviene, avísalo en "note". En el "value" cita el corte temporal del dato que cambia con el tiempo (jornada o fecha: "jornada 13, al 22 de octubre") y márcalo con "volatile": true.',
    "Si las fuentes se contradicen en un valor, no elijas al azar ni promedies: gana la fuente más reciente que declare el corte temporal del dato; si el conflicto no se resuelve, no confirmes el dato y explícalo en \"note\".",
    'Si la petición se apoya en algo que no ocurrió o no existe (por ejemplo, un partido que no es hoy), no lo inventes ni lo anuncies dentro del prompt: descríbelo en "note".',
    "Después redacta la petición del usuario como un único prompt en español de México (es-MX), listo para generar una imagen: un párrafo descriptivo (máximo 120 palabras), sin comillas, sin listas, sin título y sin frases previas ni posteriores. Da salida solo a lo que el usuario pidió: no añadas elementos, escenas, símbolos, rótulos ni textos para representar en la imagen, ni datos o afirmaciones que no estén en su petición, aunque sean reales o los haya encontrado la búsqueda. La búsqueda solo completa los datos del tema pedido (fecha, hora, cifra, nombre, sede): si alguno es imprescindible para que la imagen sea fiel, inclúyelo, y nada más.",
    'Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones: {"facts": [{"value": string, "sources": string[], "volatile": boolean}], "prompt": string, "aspectRatio": "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3", "note": string}. "facts" es la lista de datos confirmados que integraste al prompt (vacía si no hubo); "note" es opcional, una sola frase breve en es-MX, solo cuando la petición se apoye en un hecho inexistente o cuando la búsqueda no alcanzó para confirmar un dato imprescindible; omítelo si no hace falta.',
  ].join(" ")
}

/** Índice de evidencia construido con las URLs que citó el propio modelo:
 * esta API no devuelve groundingChunks, así que la verificación es por
 * autoconsistencia (existencia, formato y familias editoriales distintas). */
function evidenceIndexFromCitations(
  rawFacts: unknown
): Map<string, DetailsSource> {
  const index = new Map<string, DetailsSource>()
  if (!Array.isArray(rawFacts)) return index
  for (const entry of rawFacts) {
    const urls = (entry as { sources?: unknown })?.sources
    if (!Array.isArray(urls)) continue
    for (const url of urls) {
      if (typeof url !== "string") continue
      const trimmed = url.trim()
      if (!/^https?:\/\//i.test(trimmed)) continue
      const key = normalizeUrl(trimmed)
      if (index.has(key)) continue
      let host = trimmed
      try {
        host = new URL(trimmed).hostname.replace(/^www\./, "")
      } catch {
        continue
      }
      index.set(key, { title: host, url: trimmed, publishedDate: null })
    }
  }
  return index
}

export async function buildPromptWithGrounding(input: {
  prompt: string
  aspectRatio?: string
  referenceImages?: readonly {
    bytes: Uint8Array
    mediaType: string
  }[]
}): Promise<{
  details: PromptDetailsResult
  /** Estimación USD de la llamada completa (tokens + búsqueda). */
  costUsd: number | null
  /** true cuando el modelo incurrió en búsqueda con grounding. */
  searched: boolean
}> {
  const google = createGoogleGenerativeAI({ apiKey: groundingApiKey() })

  const content: (
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: Uint8Array }
  )[] = [
    {
      type: "text",
      text: [
        `Petición del usuario (puede venir en cualquier idioma; el resultado debe salir siempre en español de México): ${input.prompt}`,
        `Aspecto seleccionado: ${input.aspectRatio ?? "auto"}`,
      ].join("\n"),
    },
  ]
  for (const image of input.referenceImages ?? []) {
    content.push({
      type: "file",
      mediaType: image.mediaType,
      data: image.bytes,
    })
  }

  const startedAt = Date.now()
  const result = await generateText({
    model: google(resolveGroundingModel()),
    system: groundingSystemPrompt(mexicoCityNow()),
    messages: [{ role: "user", content }],
    tools: { google_search: google.tools.googleSearch({}) },
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: resolveThinkingBudget() } },
    },
    maxOutputTokens: GROUNDING_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(GROUNDING_TIMEOUT_MS),
  })

  const parsed = parseDetailsResponse(result.text)
  if (!parsed) {
    throw new Error(
      `grounding: respuesta del modelo no válida (finish=${result.finishReason ?? "?"}): ${result.text
        .trim()
        .slice(0, 300)
        .replace(/\s+/g, " ")}`
    )
  }

  const index = evidenceIndexFromCitations(parsed.facts)
  const { facts, sources, rejections } = validateFacts(parsed.facts, index)

  // Estimación de costo en USD (catálogo del AI Gateway, 2026-10-22):
  // tokens de entrada/salida del modelo + tarifa fija por búsqueda con
  // grounding ($14 por cada 1,000). La API directa de Google no reporta
  // el costo en su respuesta, así que la búsqueda se cobra como incurrida
  // cuando el modelo citó fuentes o el contexto trajo resultados inyectados.
  const inTokens = result.usage.inputTokens ?? 0
  const outTokens = result.usage.outputTokens ?? 0
  const searched = index.size > 0 || inTokens > 1_500
  const costUsd = inTokens * 0.75e-6 + outTokens * 3.75e-6 + (searched ? 0.014 : 0)

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      info: "images: details grounding",
      ms: Date.now() - startedAt,
      model: resolveGroundingModel(),
      finish: result.finishReason ?? null,
      cited: index.size,
      facts: facts.length,
      rejected: rejections.length,
      tokens: { in: inTokens, out: outTokens },
      searched,
      costUsd: Number(costUsd.toFixed(6)),
    })
  )

  const note =
    parsed.note ??
    (index.size > 0 && facts.length === 0
      ? "No pude confirmar los datos del tema con al menos dos fuentes independientes; el prompt usa solo tu descripción."
      : null)

  return {
    details: { ...parsed, note, facts, sources },
    costUsd: Number(costUsd.toFixed(6)),
    searched,
  }
}
