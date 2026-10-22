import { generateText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

import {
  type DetailsSource,
  type MexicoCityMoment,
  type PromptDetailsResult,
  type ResearchOutcome,
  MIN_FACT_SOURCES,
  buildCorrectionFeedback,
  mexicoCityNow,
  normalizeUrl,
  parseDetailsResponse,
  publisherFamilyOf,
  systemPrompt,
  userContent,
  validateFacts,
} from "@/server/images/details"
import { isSportsTopic, sportsResearchRules } from "@/server/images/sports"

/**
 * Rutas de "Insertar detalles" con Google Search grounding (la búsqueda
 * corre dentro del modelo, en la infraestructura de Google).
 *
 * ── Ruta de una llamada (temas que no necesitan datos verificados) ──────────
 * Una sola llamada a Gemini con la herramienta de búsqueda disponible: el
 * modelo decide si busca y redacta el JSON final.
 *
 * ── Ruta deportiva (investigación + síntesis, dos llamadas) ────────────────
 * En Gemini, pedirle a la misma llamada que devuelva JSON suprime el uso de
 * la herramienta de búsqueda: en cuanto ve el contrato de JSON, el modelo
 * responde con su memoria (medido: 0 llamadas a la herramienta y
 * `groundingMetadata` vacío) y los datos deportivos salen de una temporada
 * vieja. Por eso el tema deportivo se parte en dos fases:
 *
 *   1. Investigación: una llamada cuyo único trabajo es buscar y reportar los
 *      datos (texto plano, sin JSON), con la búsqueda forzosa en el prompt.
 *      El servidor comprueba que la búsqueda ocurrió (los *grounding chunks*
 *      de la respuesta) y que las URLs reportadas pertenecen a dominios que
 *      la búsqueda realmente devolvió.
 *   2. Síntesis: el modelo redacta el JSON final con la evidencia de la
 *      fase 1 y nada más; el validador del servidor exige que cada dato cite
 *      dos dominios distintos de la evidencia.
 *
 * Si la fase 1 no logra buscar (o cita URLs que la búsqueda no devolvió), se
 * reintenta una vez con una instrucción más exigente y, si tampoco, el
 * prompt se redacta SIN datos deportivos (la regla de síntesis prohíbe
 * completarlos con la memoria del modelo) y el usuario recibe el aviso en
 * "note".
 *
 * En ambas rutas, si la llamada falla, el service cae al pipeline de respaldo
 * (Tavily) sin que el usuario note nada: el botón nunca se queda sin
 * resultado.
 *
 * Requiere GEMINI_API_KEY (o GOOGLE_GENERATIVE_AI_API_KEY) en `.env`.
 */

const GROUNDING_TIMEOUT_MS = 45_000
const GROUNDING_MAX_OUTPUT_TOKENS = 4_000
const RESEARCH_MAX_OUTPUT_TOKENS = 4_000
const SYNTHESIS_MAX_OUTPUT_TOKENS = 4_000
const SYNTHESIS_TIMEOUT_MS = 45_000
const DEFAULT_GROUNDING_MODEL = "gemini-3.8-flash"
/** Intentos de investigación (búsqueda forzada) antes de degradar a un
 * prompt sin datos deportivos: el segundo intento sube la exigencia del
 * prompt de búsqueda. */
const MAX_RESEARCH_ATTEMPTS = 2
/** Tarifa de Google Search grounding (USD por cada 1,000 búsquedas). */
const GROUNDING_SEARCH_TARIFF_USD = 0.014

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

/*
 * ── Fase de investigación (tema deportivo) ──────────────────────────────
 */

/**
 * Prompt de la fase de investigación: el modelo solo busca y reporta; no
 * redacta el prompt de la imagen. Deliberadamente sin JSON: el contrato de
 * JSON es lo que suprime la llamada a la herramienta de búsqueda.
 */
function researchSystemPrompt(
  moment: MexicoCityMoment,
  options: { sports: boolean; escalated: boolean }
): string {
  const rules = [
    "Eres el investigador de datos de la herramienta de imágenes del panel de Distribuidor TVBox.",
    `Referencia temporal: ahora en Ciudad de México (${moment.offsetLabel}) es ${moment.long}, ${moment.time} (fecha ISO: ${moment.iso}). Resuelve referencias como "hoy", "esta noche" o "el próximo partido" con esa fecha y con lo que devuelva la búsqueda.`,
  ]

  if (options.sports) rules.push(sportsResearchRules(moment))

  if (options.escalated) {
    rules.push(
      "IMPORTANTE: el intento anterior quedó descartado (o no usó la herramienta de búsqueda, o sus datos no quedaron respaldados por dos páginas distintas de los resultados reales). Ahora es obligatorio: llama a google_search antes de escribir cualquier línea, aunque creas conocer la respuesta."
    )
  }

  rules.push(
    "Tu única tarea es buscar en la web y reportar los datos concretos que la petición necesita. No redactes el prompt de la imagen ni describas la escena.",
    "Responde solo con líneas de texto, sin viñetas, sin JSON y sin explicaciones, con este formato exacto por dato:",
    'DATO: <el dato en una frase> | CORTE: <la fecha o jornada a la que se aplica, o "estático"> | VOLATIL: <sí o no> | FUENTES: <URL1>, <URL2>',
    "Cada dato necesita 2 o 3 URLs de páginas distintas que lo respalden (dos páginas del mismo medio no valen) y cita la URL exacta del artículo o de la tabla que consultaste, no la portada del sitio. Si la búsqueda no confirma un dato, no lo incluyas y agrega al final una línea:",
    "AVISO: <qué no se pudo confirmar>"
  )

  return rules.join(" ")
}

/** Dato reportado por la fase de investigación. */
interface ResearchFact {
  value: string
  /** Corte temporal declarado por el investigador (fecha o jornada). */
  cut: string
  volatile: boolean
  sources: string[]
}

/**
 * Lee el informe de la fase de investigación. Es texto plano con el formato
 * "DATO: ... | CORTE: ... | VOLATIL: ... | FUENTES: url, url"; el parser es
 * tolerante a campos faltantes o con otro orden, pero descarta las líneas
 * que no traen URLs: un dato sin URL no se puede verificar.
 */
function parseResearchReport(raw: string): {
  facts: ResearchFact[]
  note: string | null
} {
  const facts: ResearchFact[] = []
  let note: string | null = null

  for (const line of raw.split(/\r?\n/)) {
    // Tolera viñetas y encabezados de markdown antes de la etiqueta.
    const trimmed = line
      .trim()
      .replace(/^[-*•>#\s]+/, "")
      .trim()
    if (trimmed.length === 0) continue

    if (/^AVISO\b/i.test(trimmed)) {
      const value = trimmed.replace(/^AVISO\s*:\s*/i, "").trim()
      if (value.length > 0) note = value.slice(0, 400)
      continue
    }

    if (!/^DATO\b/i.test(trimmed)) continue

    const parts = trimmed.split("|").map((part) => part.trim())
    const value = parts[0].replace(/^DATO\s*:\s*/i, "").trim()
    if (value.length === 0) continue

    const cutPart = parts.find((part) => /^CORTE\s*:/i.test(part))
    const volatilePart = parts.find((part) => /^VOLATIL/i.test(part))
    const sourcesPart = parts.find((part) => /^FUENTES\s*:/i.test(part))

    const sources: string[] = []
    if (sourcesPart) {
      const rawSources = sourcesPart.replace(/^FUENTES\s*:\s*/i, "")
      for (const candidate of rawSources.split(/[,\s]+/)) {
        const url = candidate.trim().replace(/[.,;]+$/, "")
        if (!/^https?:\/\//i.test(url)) continue
        if (!sources.includes(url)) sources.push(url)
      }
    }
    // Sin URLs el dato no se puede verificar: se descarta.
    if (sources.length === 0) continue

    // "sí" no lleva \b al final: "í" no es carácter de palabra en JavaScript.
    const volatile = volatilePart
      ? /^(sí|si|yes|true|1)/i.test(
          volatilePart.replace(/^VOLATIL\s*:?\s*/i, "").trim()
        )
      : false

    facts.push({
      value: value.slice(0, 300),
      cut: (cutPart ?? "")
        .replace(/^CORTE\s*:\s*/i, "")
        .trim()
        .slice(0, 120),
      volatile,
      sources,
    })
  }

  return { facts, note }
}

/** Metadata de grounding que devuelve la API de Google: los *chunks* son las
 * páginas que la búsqueda realmente abrió y sus títulos son los dominios
 * consultados; las *queries* son las consultas que el modelo formuló. */
interface GroundingInfo {
  /** Número de páginas que la búsqueda devolvió (0 = no hubo búsqueda). */
  chunks: number
  queries: string[]
  /** Dominios que la búsqueda realmente consultó. */
  domains: string[]
}

function extractGrounding(result: {
  providerMetadata?: unknown
  steps?: readonly { providerMetadata?: unknown }[]
}): GroundingInfo {
  const metas: unknown[] = []
  if (result.providerMetadata) metas.push(result.providerMetadata)
  for (const step of result.steps ?? []) {
    if (step.providerMetadata) metas.push(step.providerMetadata)
  }

  let chunks = 0
  const queries: string[] = []
  const domains: string[] = []

  for (const meta of metas) {
    const grounding = (
      meta as {
        google?: {
          groundingMetadata?: {
            groundingChunks?: { web?: { title?: string | null } | null }[]
            webSearchQueries?: string[] | null
          } | null
        }
      } | undefined
    )?.google?.groundingMetadata
    if (!grounding) continue

    chunks += grounding.groundingChunks?.length ?? 0
    for (const query of grounding.webSearchQueries ?? []) {
      if (!queries.includes(query)) queries.push(query)
    }
    for (const chunk of grounding.groundingChunks ?? []) {
      const title = chunk.web?.title?.trim().toLowerCase().replace(/^www\./, "")
      if (!title) continue
      if (!domains.includes(title)) domains.push(title)
    }
  }

  return { chunks, queries, domains }
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

/** true cuando el dominio de la URL es uno de los que devolvió la búsqueda
 * (o un subdominio de él). */
function domainWasSearched(url: string, searchedDomains: readonly string[]): boolean {
  const domain = domainOf(url)
  if (!domain) return false
  return searchedDomains.some(
    (candidate) =>
      domain === candidate ||
      domain.endsWith(`.${candidate}`) ||
      candidate.endsWith(`.${domain}`)
  )
}

/** Resultado de una llamada de investigación. */
interface GroundingResearch {
  /** Datos confirmados: cada uno con sus URLs de respaldo ya filtradas por
   * los dominios que la búsqueda realmente consultó. */
  facts: ResearchFact[]
  /** Datos que la búsqueda aportó pero que no confirmaron con dos páginas
   * de dominios distintos. */
  dropped: number
  note: string | null
  /** La llamada usó la búsqueda (hubo grounding chunks). */
  searched: boolean
  /** Consultas que el modelo formuló. */
  queries: string[]
  /** Dominios que la búsqueda realmente consultó. */
  domains: string[]
  /** URLs reportadas que pertenecen a dominios que la búsqueda consultó. */
  backedSources: string[]
  costUsd: number
  ms: number
}

async function runGroundingResearch(
  input: { prompt: string },
  moment: MexicoCityMoment,
  options: { sports: boolean; escalated: boolean }
): Promise<GroundingResearch> {
  const google = createGoogleGenerativeAI({ apiKey: groundingApiKey() })
  const startedAt = Date.now()

  const result = await generateText({
    model: google(resolveGroundingModel()),
    system: researchSystemPrompt(moment, options),
    messages: [
      {
        role: "user",
        content: [
          `Petición del usuario (puede venir en cualquier idioma): ${input.prompt}`,
          options.sports
            ? "Investiga con google_search y reporta los datos que la petición necesita. Es obligatorio usar la herramienta de búsqueda antes de responder."
            : "Investiga con google_search y reporta los datos que la petición necesita.",
        ].join("\n"),
      },
    ],
    tools: { google_search: google.tools.googleSearch({}) },
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: resolveThinkingBudget() } },
    },
    maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(GROUNDING_TIMEOUT_MS),
  })

  const grounding = extractGrounding(result)
  const { facts, note } = parseResearchReport(result.text)

  // Un dato solo se conserva si la búsqueda realmente abrió dos páginas
  // distintas que lo respalden: las URLs que el investigador reporta pero
  // cuyo dominio la búsqueda no consultó (o que apuntan a una sola casa
  // editorial) no sirven como confirmación.
  const confirmed: ResearchFact[] = []
  const allSources = facts.flatMap((fact) => fact.sources)
  let dropped = 0
  for (const fact of facts) {
    const backed = grounding.domains.length
      ? fact.sources.filter((url) => domainWasSearched(url, grounding.domains))
      : fact.sources
    const families = new Set(
      backed.map((url) => publisherFamilyOf(domainOf(url) ?? url))
    )
    if (backed.length < MIN_FACT_SOURCES || families.size < MIN_FACT_SOURCES) {
      dropped += 1
      continue
    }
    confirmed.push({ ...fact, sources: backed })
  }

  const backedSources = confirmed.flatMap((fact) => fact.sources)

  const inTokens = result.usage.inputTokens ?? 0
  const outTokens = result.usage.outputTokens ?? 0
  const searched = grounding.chunks > 0
  const costUsd =
    inTokens * 0.75e-6 +
    outTokens * 3.75e-6 +
    (searched ? GROUNDING_SEARCH_TARIFF_USD : 0)

  const finalNote =
    dropped > 0
      ? [
          note,
          `${dropped} ${dropped === 1 ? "dato quedó" : "datos quedaron"} sin confirmación de dos páginas distintas de la búsqueda.`,
        ]
          .filter((part) => part !== null && part.length > 0)
          .join(" ")
      : note

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      info: "images: details grounding research",
      ms: Date.now() - startedAt,
      model: resolveGroundingModel(),
      escalated: options.escalated,
      chunks: grounding.chunks,
      queries: grounding.queries,
      domains: grounding.domains,
      facts: confirmed.length,
      dropped,
      sources: allSources.length,
      backed: backedSources.length,
      searched,
      costUsd: Number(costUsd.toFixed(6)),
    })
  )

  return {
    facts: confirmed,
    dropped,
    note: finalNote,
    searched,
    queries: grounding.queries,
    domains: grounding.domains,
    backedSources,
    costUsd,
    ms: Date.now() - startedAt,
  }
}

/**
 * Convierte el informe de investigación en la evidencia que consume la
 * síntesis: las URLs reportadas son el conjunto único de resultados reales, y
 * el texto es el bloque que el modelo lee.
 */
function researchToOutcome(research: GroundingResearch): ResearchOutcome {
  const index = new Map<string, DetailsSource>()
  const lines: string[] = []

  for (const fact of research.facts) {
    for (const url of fact.sources) {
      const key = normalizeUrl(url)
      if (index.has(key)) continue
      index.set(key, {
        title: domainOf(url) ?? url,
        url,
        publishedDate: null,
      })
    }
    lines.push(
      [
        `DATO: ${fact.value}`,
        fact.cut.length > 0 ? `CORTE: ${fact.cut}` : null,
        `VOLATIL: ${fact.volatile ? "sí" : "no"}`,
        `FUENTES: ${fact.sources.join(", ")}`,
      ]
        .filter((part) => part !== null)
        .join(" | ")
    )
  }

  const text = [
    "EVIDENCIA DE BÚSQUEDA (Google Search grounding). Son resultados reales de la búsqueda web; fuera de ellos no tienes acceso a internet ni más información:",
    "",
    lines.join("\n"),
    ...(research.note ? ["", `AVISO DE LA BÚSQUEDA: ${research.note}`] : []),
  ].join("\n")

  return {
    evidence: [],
    text,
    index,
    volatile: research.facts.some((fact) => fact.volatile),
  }
}

/**
 * Fase de síntesis de la ruta deportiva: redacta el JSON final con la
 * evidencia de la fase de investigación. Va contra la API directa de Google
 * (no por el gateway): la llamada no necesita la herramienta de búsqueda —ya
 * tiene la evidencia— y así evita el costo y la latencia del proxy.
 *
 * Dos intentos como máximo: el primero normal y, si el JSON no parsea o el
 * validador rechaza las citas, el segundo con la causa exacta del rechazo.
 */
async function synthesizeSportsPrompt(
  input: {
    prompt: string
    aspectRatio?: string
    referenceImages?: readonly {
      bytes: Uint8Array
      mediaType: string
    }[]
  },
  moment: MexicoCityMoment,
  evidence: ResearchOutcome | null
): Promise<{ details: PromptDetailsResult; costUsd: number }> {
  const google = createGoogleGenerativeAI({ apiKey: groundingApiKey() })
  const index = evidence?.index ?? null

  const userText = userContent(
    {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio ?? "auto",
    },
    evidence?.text ?? null
  )

  let costUsd = 0
  let feedback: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const content: (
      | { type: "text"; text: string }
      | { type: "file"; mediaType: string; data: Uint8Array }
    )[] = [
      {
        type: "text",
        text: feedback ? `${userText}\n\n${feedback}` : userText,
      },
    ]
    for (const image of input.referenceImages ?? []) {
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.bytes,
      })
    }

    const result = await generateText({
      model: google(resolveGroundingModel()),
      system: systemPrompt(moment, evidence !== null, { sports: true }),
      messages: [{ role: "user", content }],
      maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
    })

    costUsd +=
      (result.usage.inputTokens ?? 0) * 0.75e-6 +
      (result.usage.outputTokens ?? 0) * 3.75e-6

    const parsed = parseDetailsResponse(result.text)
    if (!parsed) {
      feedback =
        "Tu respuesta anterior no fue JSON válido. Responde de nuevo ÚNICAMENTE con el JSON completo (sin markdown, sin texto antes ni después)."
      continue
    }

    const { facts, sources, rejections } = validateFacts(parsed.facts, index)

    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        info: "images: details grounding synthesis",
        research: evidence !== null,
        correction: Boolean(feedback),
        facts: facts.length,
        rejected: rejections.length,
      })
    )

    if (facts.length === 0 && rejections.length > 0 && index && !feedback) {
      feedback = buildCorrectionFeedback(rejections)
      continue
    }

    const note =
      parsed.note ??
      (evidence && facts.length === 0
        ? "No pude confirmar los datos de la búsqueda con al menos dos fuentes independientes; el prompt usa solo tu descripción."
        : !evidence
          ? "No pude verificar los datos deportivos en la web; el prompt describe la escena sin los datos que no alcancé a confirmar."
          : null)

    return {
      details: { ...parsed, note, facts, sources },
      costUsd,
    }
  }

  throw new Error("grounding: no se pudo sintetizar el prompt del tema deportivo")
}

/**
 * Ruta deportiva: investigación forzada + síntesis con la evidencia.
 * Si la búsqueda no ocurre (o sus URLs no pertenecen a los dominios que la
 * búsqueda consultó), se reintenta una vez y, si tampoco, el prompt se
 * redacta sin datos deportivos: la regla de síntesis prohíbe completarlos
 * con la memoria del modelo y el usuario recibe el aviso en "note".
 */
async function buildSportsPromptWithGrounding(input: {
  prompt: string
  aspectRatio?: string
  referenceImages?: readonly {
    bytes: Uint8Array
    mediaType: string
  }[]
}): Promise<{
  details: PromptDetailsResult
  costUsd: number | null
  searched: boolean
}> {
  const moment = mexicoCityNow()
  let costUsd = 0
  let searched = false
  let outcome: ResearchOutcome | null = null

  for (let attempt = 0; attempt < MAX_RESEARCH_ATTEMPTS; attempt++) {
    const research = await runGroundingResearch(input, moment, {
      sports: true,
      escalated: attempt > 0,
    })
    costUsd += research.costUsd
    searched = searched || research.searched

    // La búsqueda ocurrió y confirmó algún dato con dos páginas distintas:
    // la evidencia es confiable.
    if (research.searched && research.facts.length > 0) {
      outcome = researchToOutcome(research)
      break
    }

    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        info: "images: details grounding research sin respaldo",
        attempt: attempt + 1,
        searched: research.searched,
        chunks: research.domains.length,
        facts: research.facts.length,
        dropped: research.dropped,
        sources: research.backedSources.length,
      })
    )
  }

  const synthesis = await synthesizeSportsPrompt(input, moment, outcome)
  costUsd += synthesis.costUsd

  return {
    details: synthesis.details,
    costUsd: Number(costUsd.toFixed(6)),
    searched,
  }
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
  // Tema deportivo: la búsqueda es obligatoria, así que va en su propia fase
  // (investigación + síntesis). El resto usa la ruta de una sola llamada.
  if (isSportsTopic(input.prompt)) {
    return buildSportsPromptWithGrounding(input)
  }

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
  const costUsd =
    inTokens * 0.75e-6 + outTokens * 3.75e-6 + (searched ? GROUNDING_SEARCH_TARIFF_USD : 0)

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
