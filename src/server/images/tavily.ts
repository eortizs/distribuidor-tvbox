/*
 * Tavily Search: motor de investigación de "Insertar detalles".
 *
 * Se llama directo a la API REST (no hay SDK instalado) con parámetros
 * orientados a datos verificables: profundidad avanzada, fecha de
 * publicación y preferencia por fuentes en español y de México.
 */

const TAVILY_SEARCH_URL = "https://api.tavily.com/search"
const TAVILY_TIMEOUT_MS = 15_000
const TAVILY_MAX_RESULTS = 8

export type TavilyTopic = "general" | "news"

/** Acotar a resultados recientes: para datos que cambian con el tiempo
 * (tablas de posiciones, marcadores, clasificaciones) una fuente vieja
 * puede traer el estado anterior y corroborarse con otra igual de vieja. */
export type TavilyTimeRange = "day" | "week" | "month"

export interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
  publishedDate: string | null
}

export interface TavilyEvidence {
  query: string
  topic: TavilyTopic
  /** Respuesta sintetizada por Tavily: sirve de referencia, no de fuente. */
  answer: string | null
  results: TavilyResult[]
  /** true cuando la búsqueda se restringió a medios verificados. */
  trusted: boolean
}

export function tavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim())
}

export async function tavilySearch(
  query: string,
  topic: TavilyTopic,
  options: { timeRange?: TavilyTimeRange; includeDomains?: readonly string[] } = {}
): Promise<TavilyEvidence> {
  const apiKey = process.env.TAVILY_API_KEY?.trim()
  if (!apiKey) throw new Error("tavily: falta TAVILY_API_KEY")

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query,
      topic,
      search_depth: "advanced",
      max_results: TAVILY_MAX_RESULTS,
      include_answer: "advanced",
      include_published_date: true,
      // Fuentes en español primero; el país solo aplica en búsquedas generales.
      language: "es",
      ...(topic === "general" ? { country: "mexico" } : {}),
      ...(options.timeRange ? { time_range: options.timeRange } : {}),
      ...(options.includeDomains && options.includeDomains.length > 0
        ? { include_domains: options.includeDomains }
        : {}),
    }),
  })

  if (!response.ok) throw new Error(`tavily: HTTP ${response.status}`)

  const payload = (await response.json().catch(() => null)) as {
    answer?: unknown
    results?: unknown
  } | null
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error("tavily: respuesta inesperada")
  }

  const results: TavilyResult[] = []
  for (const entry of payload.results) {
    const result = entry as {
      title?: unknown
      url?: unknown
      content?: unknown
      score?: unknown
      published_date?: unknown
    }
    const url = typeof result.url === "string" ? result.url.trim() : ""
    if (!/^https?:\/\//i.test(url)) continue
    results.push({
      title:
        typeof result.title === "string" && result.title.trim().length > 0
          ? result.title.trim()
          : url,
      url,
      content: typeof result.content === "string" ? result.content : "",
      score: typeof result.score === "number" ? result.score : 0,
      publishedDate:
        typeof result.published_date === "string" ? result.published_date : null,
    })
  }

  return {
    query,
    topic,
    answer: typeof payload.answer === "string" ? payload.answer : null,
    results,
    trusted: false,
  }
}
