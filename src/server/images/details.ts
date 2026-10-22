import { generateText } from "ai"
import { gateway } from "@ai-sdk/gateway"

import { AppError } from "@/server/umejson/types"
import { tavilyConfigured, tavilySearch, type TavilyEvidence, type TavilyTopic } from "@/server/images/tavily"

/**
 * "Insertar detalles": el modelo interpreta la petición del usuario, planifica
 * una investigación, la ejecuta con Tavily y redacta el prompt final solo con
 * los datos que quedaron confirmados por al menos dos fuentes independientes.
 *
 * 1. Planificación (LLM): decide si hace falta investigar y con qué búsquedas.
 * 2. Investigación (Tavily): hasta tres búsquedas avanzadas, en paralelo;
 *    las volátiles se acotan a la última semana y, en deportes de México,
 *    primero se restringen a medios verificados.
 * 3. Síntesis (LLM): con la evidencia real como único material externo; cada
 *    dato que integra al prompt debe venir con sus URLs de respaldo. Si nada
 *    se confirmó y el dato era volátil, una ronda de refinamiento busca lo
 *    que faltó y se re-sintetiza.
 * 4. Validación (servidor): descarta cualquier dato citado con URLs que no
 *    estén en los resultados reales de Tavily o sin dos dominios distintos;
 *    los datos volátiles (tablas, marcadores, clasificaciones) exigen,
 *    además, una fuente publicada en la última semana.
 */

const DEFAULT_DETAILS_MODEL = "anthropic/claude-haiku-5.5"
const DETAILS_TIMEOUT_MS = 60_000
// El tope incluye el presupuesto de razonamiento del modelo y las citas con
// URLs largas: si queda corto, el JSON se trunca a media URL (una tabla de
// cinco equipos con sus citas supera los 8 k tokens con el razonamiento).
// La validación posterior acota el tamaño real de prompt, facts y note.
const DETAILS_MAX_OUTPUT_TOKENS = 16_000
const DETAILS_PLAN_TIMEOUT_MS = 20_000
const DETAILS_PLAN_MAX_OUTPUT_TOKENS = 1500
const MAX_DETAILS_PROMPT_LENGTH = 2000
const MAX_SOURCES = 8
const MAX_DETAILS_NOTE_LENGTH = 400
const MAX_QUERIES = 3
const MIN_QUERY_LENGTH = 4
const MAX_QUERY_LENGTH = 200
const MIN_FACT_SOURCES = 2
const MAX_FACTS = 6
const MAX_FACT_LENGTH = 300
/** Un dato volátil solo se acepta con una fuente publicada o actualizada
 * dentro de esta ventana: dos fuentes viejas pueden corroborarse entre sí
 * con el estado anterior (la tabla de la jornada pasada, p. ej.). */
const VOLATILE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000
/** Si la evidencia fechada más fresca superara esta edad, el dato volátil
 * puede haber cambiado desde entonces: se intenta una ronda de refinamiento
 * antes de conformarse con un corte viejo. */
const STALE_EVIDENCE_MS = 3 * 60 * 60 * 1000
const EVIDENCE_RESULTS_PER_QUERY = 6
const EVIDENCE_SNIPPET_CHARS = 600

/**
 * Medios verificados por categoría: para datos volátiles la búsqueda se
 * restringe primero a estos dominios (medios deportivos establecidos de
 * México y la fuente oficial de la liga); la web abierta queda como
 * respaldo cuando ellos no traen resultados.
 */
const TRUSTED_DOMAIN_CATEGORIES: Record<string, readonly string[]> = {
  "deportes-mx": [
    "espn.com.mx",
    "espndeportes.espn.com",
    "mediotiempo.com",
    "ligamx.net",
    "tudn.com",
    "record.com.mx",
    "aztecadeportes.com",
  ],
}

export function isTrustedDomainCategory(value: unknown): value is keyof typeof TRUSTED_DOMAIN_CATEGORIES {
  return typeof value === "string" && value in TRUSTED_DOMAIN_CATEGORIES
}

const MEXICO_CITY_TIME_ZONE = "America/Mexico_City"

const MX_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: MEXICO_CITY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const MX_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: MEXICO_CITY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const MX_LONG_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  timeZone: MEXICO_CITY_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

const WEEKDAY_NAMES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
]

export interface DetailsSource {
  title: string
  url: string
  /** Fecha de publicación o actualización que reporta Tavily, si la hay. */
  publishedDate: string | null
}

/** Dato confirmado por al menos dos fuentes independientes (dominios distintos). */
export interface DetailsFact {
  value: string
  sources: DetailsSource[]
}

export interface DetailsReferenceImage {
  bytes: Uint8Array
  mediaType: string
}

export interface PromptDetailsInput {
  prompt: string
  aspectRatio?: string
  referenceImages?: readonly DetailsReferenceImage[]
}

export interface PromptDetailsResult {
  prompt: string
  aspectRatio: string | null
  /** Aviso para el usuario (fuera del prompt) cuando la petición se apoya en
   * un hecho que no ocurrió o no existe. */
  note: string | null
  /** Fuentes que respaldan los datos confirmados (dos o más por dato). */
  sources: DetailsSource[]
  /** Datos confirmados que se integraron al prompt, cada uno con sus fuentes. */
  facts: DetailsFact[]
}

/**
 * Momento actual en Ciudad de México, ya validado: la fecha, la hora y el
 * día de la semana se calculan por dos caminos independientes y, si no
 * coinciden, el módulo falla en vez de pasarle al modelo una fecha equivocada.
 */
export interface MexicoCityMoment {
  /** Fecha ISO: 2026-10-21 */
  iso: string
  /** Día de la semana: miércoles */
  weekday: string
  /** Hora de 24 h: 17:46 */
  time: string
  /** Fecha larga en español: miércoles, 21 de octubre de 2026 */
  long: string
  /** Desfase de la zona: GMT-06:00 */
  offsetLabel: string
}

function formatPart(
  formatter: Intl.DateTimeFormat,
  type: Intl.DateTimeFormatPartTypes,
  value: Date
): string {
  return formatter.formatToParts(value).find((part) => part.type === type)?.value ?? ""
}

function parseOffsetMinutes(offsetLabel: string): number | null {
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return null
  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? "0")
  return sign * (hours * 60 + minutes)
}

function weekdayFromIso(iso: string): string | null {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return WEEKDAY_NAMES[date.getUTCDay()] ?? null
}

/*
 * El instante se convierte a hora de Ciudad de México de dos formas: con el
 * formateador de ICU (que aplica la zona) y a mano, sumando a la hora UTC el
 * desfase que la propia zona reporta. Si las dos no coinciden, o si el día de
 * la semana no corresponde a la fecha, la validación falla.
 */
function mexicoCityNow(): MexicoCityMoment {
  const now = new Date()

  const iso = formatPart(MX_DATE_FORMATTER, "year", now)
  const month = formatPart(MX_DATE_FORMATTER, "month", now)
  const day = formatPart(MX_DATE_FORMATTER, "day", now)
  const dateIso = `${iso}-${month}-${day}`

  const time = formatPart(MX_TIME_FORMATTER, "hour", now)
  const minute = formatPart(MX_TIME_FORMATTER, "minute", now)
  const clock = `${time}:${minute}`

  const long = MX_LONG_FORMATTER.format(now)

  const offsetLabel =
    new Intl.DateTimeFormat("en-US", {
      timeZone: MEXICO_CITY_TIME_ZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  const offsetMinutes = parseOffsetMinutes(offsetLabel)

  if (!offsetMinutes && offsetMinutes !== 0) {
    throw new AppError(
      500,
      "details_time_unavailable",
      "No se pudo determinar la hora de Ciudad de México en el servidor."
    )
  }

  // Fecha y hora recalculadas desde el desfase de la zona.
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000)
  const expectedDate = shifted.toISOString().slice(0, 10)
  const expectedClock = `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(
    shifted.getUTCMinutes()
  ).padStart(2, "0")}`

  const weekday = weekdayFromIso(dateIso)

  if (
    expectedDate !== dateIso ||
    expectedClock !== clock ||
    !weekday ||
    !long.toLowerCase().includes(weekday)
  ) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: fallo la validación de la hora de Ciudad de México (iso=${dateIso}, clock=${clock}, esperado=${expectedDate} ${expectedClock}, weekday=${weekday}, zona=${offsetLabel})`,
      })
    )
    throw new AppError(
      500,
      "details_time_unverified",
      "El servidor no pudo verificar la fecha y la hora de Ciudad de México. Inténtalo de nuevo en unos momentos."
    )
  }

  return {
    iso: dateIso,
    weekday,
    time: clock,
    long,
    offsetLabel: offsetLabel || "GMT-06:00",
  }
}

function resolveModel(): string {
  const configured = process.env.IMAGE_DETAILS_MODEL?.trim()
  return configured && configured.length > 0 ? configured : DEFAULT_DETAILS_MODEL
}

/** JSON tolerante: acepta markdown alrededor y toma el primer objeto balanceado. */
function parseJsonLoose(raw: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

/*
 * ── Paso 1: planificación de la investigación ─────────────────────────────
 */

interface ResearchQuery {
  q: string
  topic: TavilyTopic
  /** El dato buscado cambia con el tiempo (tabla, marcador, clasificación):
   * la búsqueda se acota a la última semana. */
  volatile: boolean
  /** Categoría con medios verificados (p. ej. deportes de México): la
   * búsqueda se restringe primero a esos dominios. */
  category: string | null
}

interface ResearchPlan {
  research: boolean
  queries: ResearchQuery[]
}

function planSystemPrompt(moment: MexicoCityMoment): string {
  return [
    "Eres el planificador de investigación de la herramienta de imágenes del panel de Distribuidor TVBox.",
    `Referencia temporal: ahora en Ciudad de México (${moment.offsetLabel}) es ${moment.long}, ${moment.time} (fecha ISO: ${moment.iso}). Resuelve referencias como "hoy", "esta noche" o "el próximo partido" con esa fecha.`,
    "Tu única tarea es decidir si la petición necesita investigación en internet y con qué búsquedas, nada más.",
    'Necesita investigación ("research": true) cuando la imagen depende de datos externos concretos y verificables: eventos deportivos o de espectáculos, partidos, fechas, horarios, resultados, clasificaciones, cifras, nombres propios actuales o cualquier tema puntual o reciente. No necesita investigación cuando todo sale de la imaginación o del conocimiento estable (personajes ficticios, paisajes, logos, ilustraciones, "un ajolote astronauta"). Ante la duda, investiga.',
    'Genera hasta 3 búsquedas distintas y específicas, en español de México (es-MX), con los nombres propios como se usan en México ("El Tri", "la Selección Mexicana", "liga MX"). Usa el tema "news" para eventos en vivo, partidos, resultados o noticias de los últimos días; "general" para todo lo demás. Marca "volatile": true cuando el dato buscado cambia con el tiempo (tabla de posiciones, puntos, marcador, clasificación, racha, clima, cotización): en esas búsquedas incluye la fecha o la jornada actual ("tabla general Liga MX octubre 2026", "puntos América jornada 13 Apertura 2026") para no recuperar el estado anterior. Si el dato puede haber cambiado hoy (jornada en curso, evento en vivo), incluye una búsqueda orientada a los resultados del día con tema "news" (p. ej., "resultados jornada 13 Liga MX hoy"). Cuando la búsqueda trate de deportes en México (Liga MX, Selección Mexicana, box, F1, cualquier competición o evento deportivo del país), usa "category": "deportes-mx", que restringe la búsqueda a medios deportivos verificados.',
    'Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones: {"research": boolean, "queries": [{"q": string, "topic": "general" | "news", "volatile": boolean, "category": "deportes-mx" | null}]}. Si "research" es false, devuelve "queries" vacío.',
  ].join(" ")
}

async function planResearch(
  input: PromptDetailsInput,
  moment: MexicoCityMoment
): Promise<ResearchPlan> {
  const result = await generateText({
    model: gateway.languageModel(resolveModel()),
    system: planSystemPrompt(moment),
    messages: [
      { role: "user", content: `Petición del usuario (puede venir en cualquier idioma): ${input.prompt}` },
    ],
    maxOutputTokens: DETAILS_PLAN_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(DETAILS_PLAN_TIMEOUT_MS),
  })

  const parsed = parseJsonLoose(result.text)
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("plan: respuesta del modelo no válida")
  }

  const { research, queries } = parsed as Record<string, unknown>
  const plan: ResearchPlan = {
    research: research === true,
    queries: [],
  }
  if (!plan.research || !Array.isArray(queries)) return plan

  const seen = new Set<string>()
  for (const entry of queries) {
    if (plan.queries.length >= MAX_QUERIES) break
    const query = entry as {
      q?: unknown
      topic?: unknown
      volatile?: unknown
      category?: unknown
    }
    const q = typeof query.q === "string" ? query.q.trim() : ""
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    plan.queries.push({
      q,
      topic: query.topic === "news" ? "news" : "general",
      volatile: query.volatile === true,
      category: isTrustedDomainCategory(query.category) ? query.category : null,
    })
  }

  if (plan.queries.length === 0) plan.research = false
  return plan
}

/*
 * ── Paso 2: investigación con Tavily ──────────────────────────────────────
 */

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
  } catch {
    return url.trim().replace(/\/+$/, "")
  }
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

/**
 * Familia editorial del dominio: espn.com.mx y espndeportes.espn.com son
 * ESPN (a veces el mismo contenido en dos hosts), tvazteca.com y
 * aztecadeportes.com son Azteca. La corroboración de un dato debe venir de
 * familias editoriales distintas, no de dos puertas del mismo medio.
 */
function publisherFamilyOf(domain: string): string {
  if (domain.includes("espn")) return "espn"
  if (domain.includes("azteca")) return "azteca"
  if (domain.includes("mediotiempo")) return "mediotiempo"
  if (domain.includes("record")) return "record"
  if (domain.includes("clarosports")) return "claro"
  return domain
}

/** Resultado de la investigación: evidencia, texto para el modelo, índice de
 * URLs reales y si algún dato buscado era volátil (habilita refinamiento). */
interface ResearchOutcome {
  evidence: TavilyEvidence[]
  text: string
  /** URL normalizada → fuente; es el conjunto único de resultados reales. */
  index: Map<string, DetailsSource>
  volatile: boolean
}

function buildEvidenceText(evidence: TavilyEvidence[]): string {
  const blocks = evidence.map((search, index) => {
    const lines: string[] = []
    lines.push(
      `Búsqueda ${index + 1} (${search.topic === "news" ? "noticias" : "general"}${search.trusted ? ", restringida a medios verificados" : ""}): "${search.query}"`
    )
    if (search.answer) {
      lines.push(
        `Respuesta del buscador (solo referencia, no cuenta como fuente): ${search.answer}`
      )
    }
    for (const result of search.results.slice(0, EVIDENCE_RESULTS_PER_QUERY)) {
      const snippet =
        result.content.length > EVIDENCE_SNIPPET_CHARS
          ? `${result.content.slice(0, EVIDENCE_SNIPPET_CHARS)}…`
          : result.content
      lines.push(
        `- ${result.title} — ${result.url}${result.publishedDate ? ` — publicado: ${result.publishedDate}` : ""}`
      )
      lines.push(`  ${snippet}`)
    }
    return lines.join("\n")
  })
  return [
    "EVIDENCIA DE BÚSQUEDA (Tavily). Son todos los resultados reales disponibles; fuera de ellos no tienes más información:",
    "",
    blocks.join("\n\n"),
  ].join("\n")
}

/**
 * Ejecuta una búsqueda del plan: si tiene categoría con medios verificados,
 * prueba primero restringida a esos dominios y, solo si no arroja nada (o
 * falla), abre la búsqueda al resto de la web. Devuelve null si ninguna
 * variante trae resultados.
 */
async function runSearch(query: ResearchQuery): Promise<TavilyEvidence | null> {
  const timeRange = query.volatile ? ("week" as const) : undefined
  const trusted = query.category ? TRUSTED_DOMAIN_CATEGORIES[query.category] : undefined
  const variants: { includeDomains?: readonly string[] }[] = trusted
    ? [{ includeDomains: trusted }, {}]
    : [{}]

  for (const variant of variants) {
    try {
      const evidence = await tavilySearch(query.q, query.topic, {
        timeRange,
        ...(variant.includeDomains ? { includeDomains: variant.includeDomains } : {}),
      })
      if (evidence.results.length > 0) {
        return { ...evidence, trusted: Boolean(variant.includeDomains) }
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: details tavily query failed (q="${query.q}", trusted=${Boolean(variant.includeDomains)}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  }
  return null
}

async function researchWithTavily(
  input: PromptDetailsInput,
  moment: MexicoCityMoment
): Promise<ResearchOutcome | null> {
  const plan = await planResearch(input, moment)
  if (!plan.research || plan.queries.length === 0) return null

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      info: "images: details research plan",
      queries: plan.queries.map(({ q, topic, volatile, category }) => ({
        q,
        topic,
        volatile,
        category,
      })),
    })
  )

  const searches = await Promise.all(plan.queries.map((query) => runSearch(query)))

  const evidence: TavilyEvidence[] = []
  const index = new Map<string, DetailsSource>()
  for (const search of searches) {
    if (!search) continue
    evidence.push(search)
    for (const result of search.results) {
      const key = normalizeUrl(result.url)
      if (!index.has(key)) {
        index.set(key, {
          title: result.title,
          url: result.url,
          publishedDate: result.publishedDate,
        })
      }
    }
  }

  if (evidence.length === 0) return null
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      info: "images: details research evidence",
      searches: evidence.map((search) => ({
        q: search.query,
        trusted: search.trusted,
        results: search.results.length,
      })),
    })
  )
  return {
    evidence,
    text: buildEvidenceText(evidence),
    index,
    volatile: plan.queries.some((query) => query.volatile),
  }
}

/*
 * Ronda de refinamiento: cuando la primera síntesis no confirmó ningún dato
 * y el plan era volátil, el LLM genera búsquedas dirigidas a lo que faltó
 * (típicamente el resultado final de los partidos pendientes de la fecha,
 * que se publica antes que la tabla consolidada) y la evidencia se fusiona
 * para re-sintetizar. Una sola ronda.
 */

function evidenceDigest(evidence: TavilyEvidence[]): string {
  return evidence
    .map((search) => {
      const lines = search.results
        .slice(0, EVIDENCE_RESULTS_PER_QUERY)
        .map(
          (result) =>
            `- ${result.title} (${result.publishedDate ?? "sin fecha"}) ${result.url}`
        )
      return [`Búsqueda "${search.query}"`, ...lines].join("\n")
    })
    .join("\n\n")
}

function refinementPlanPrompt(moment: MexicoCityMoment): string {
  return [
    "Eres el planificador de investigación de la herramienta de imágenes del panel de Distribuidor TVBox.",
    `Referencia temporal: ahora en Ciudad de México (${moment.offsetLabel}) es ${moment.long}, ${moment.time} (fecha ISO: ${moment.iso}).`,
    "La primera ronda de búsquedas no logró confirmar con dos fuentes independientes los datos que la petición necesita. Genera hasta 3 búsquedas nuevas y más específicas para llenar el hueco:",
    '- Si la evidencia menciona partidos o eventos pendientes o en vivo, busca directamente su resultado final nombrando el enfrentamiento ("Atlas vs América resultado jornada 13").',
    '- Prueba otras formulaciones del dato ("así quedó la tabla jornada 13"), la fuente oficial del organizador, u otros ángulos del mismo dato.',
    "- No repitas búsquedas de la primera ronda.",
    'Escribe en español de México (es-MX). Usa el tema "news" para eventos en vivo, partidos o resultados de los últimos días; "general" para el resto. Marca "volatile": true cuando el dato cambie con el tiempo. Para deportes en México usa "category": "deportes-mx".',
    'Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones: {"queries": [{"q": string, "topic": "general" | "news", "volatile": boolean, "category": "deportes-mx" | null}]}.',
  ].join(" ")
}

async function refineResearch(
  input: PromptDetailsInput,
  moment: MexicoCityMoment,
  current: ResearchOutcome,
  failedNote: string | null
): Promise<ResearchOutcome | null> {
  const result = await generateText({
    model: gateway.languageModel(resolveModel()),
    system: refinementPlanPrompt(moment),
    messages: [
      {
        role: "user",
        content: [
          `Petición del usuario: ${input.prompt}`,
          `Aviso del intento anterior: ${failedNote ?? "no se confirmó ningún dato"}`,
          "Resultados de la primera ronda:",
          evidenceDigest(current.evidence),
        ].join("\n\n"),
      },
    ],
    maxOutputTokens: DETAILS_PLAN_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(DETAILS_PLAN_TIMEOUT_MS),
  })

  const parsed = parseJsonLoose(result.text)
  if (typeof parsed !== "object" || parsed === null) return null
  const { queries } = parsed as Record<string, unknown>
  if (!Array.isArray(queries) || queries.length === 0) return null

  const seen = new Set<string>()
  const plan: ResearchQuery[] = []
  for (const entry of queries) {
    if (plan.length >= MAX_QUERIES) break
    const query = entry as {
      q?: unknown
      topic?: unknown
      volatile?: unknown
      category?: unknown
    }
    const q = typeof query.q === "string" ? query.q.trim() : ""
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    plan.push({
      q,
      topic: query.topic === "news" ? "news" : "general",
      volatile: query.volatile === true,
      category: isTrustedDomainCategory(query.category) ? query.category : null,
    })
  }
  if (plan.length === 0) return null

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      info: "images: details research refinement",
      queries: plan.map(({ q, topic, volatile, category }) => ({ q, topic, volatile, category })),
    })
  )

  const searches = await Promise.all(plan.map((query) => runSearch(query)))
  const fresh = searches.filter((search) => search !== null)
  if (fresh.length === 0) return null

  const evidence = [...current.evidence, ...fresh]
  const index = new Map(current.index)
  for (const search of fresh) {
    for (const result of search.results) {
      const key = normalizeUrl(result.url)
      if (!index.has(key)) {
        index.set(key, {
          title: result.title,
          url: result.url,
          publishedDate: result.publishedDate,
        })
      }
    }
  }
  return {
    evidence,
    text: buildEvidenceText(evidence),
    index,
    volatile: true,
  }
}

/*
 * ── Paso 3: síntesis con verificación ─────────────────────────────────────
 */

/*
 * Con evidencia: el modelo redacta con los resultados de Tavily como único
 * material externo y confirma cada dato con dos fuentes independientes.
 * Sin evidencia (respaldo): solo reescribe con lo que ya sabe.
 */
function systemPrompt(
  moment: MexicoCityMoment,
  withResearch: boolean
): string {
  const rules = [
    "Eres el director de arte de la herramienta de imágenes del panel de Distribuidor TVBox.",
    `Referencia temporal: ahora en Ciudad de México (${moment.offsetLabel}) es ${moment.long}, ${moment.time} (fecha ISO: ${moment.iso}). Resuelve referencias como "hoy", "esta noche" o "el próximo partido" con esa fecha y con los resultados de la búsqueda.`,
    "Maneja los horarios exclusivamente en hora del centro de México (Ciudad de México). Traduce a esa zona cualquier hora que encuentres y no agregues la zona ni la hora local de origen: escribe solo la hora de Ciudad de México (por ejemplo, \"19:00\"), sin \"hora local\", sin \"GMT\" y sin nombrar la ciudad de origen.",
    "Todo lo que escribas va siempre en español de México (es-MX), sin excepción, aunque el usuario te escriba en otro idioma: si su petición está en inglés o en otro idioma, tradúcela al español de México. Usa el léxico y las referencias propias de México (\"El Tri\", \"la Selección Mexicana\", \"liga MX\", \"el cine de la Condesa\"), nunca otra variante regional del español (por ejemplo, \"ordenador\", \"coche\", \"vosotros\") ni otro idioma.",
  ]

  if (withResearch) {
    rules.push(
      "Primero revisa la EVIDENCIA DE BÚSQUEDA que acompaña a la petición: son resultados reales de Tavily; fuera de ellos no tienes acceso a internet ni más información.",
      "De la evidencia extrae solo los datos concretos que la petición necesita: fechas, horarios, marcadores, cifras, eventos, nombres propios o sedes. Un dato queda confirmado únicamente cuando lo respaldan al menos dos resultados de familias editoriales distintas: dos resultados del mismo dominio cuentan como una sola fuente, y también dos marcas del mismo medio (espn.com.mx y espndeportes.espn.com son ESPN; tvazteca.com y aztecadeportes.com son Azteca). La respuesta del buscador es solo una referencia y nunca cuenta como fuente.",
      "Cada dato confirmado que integres al prompt debe aparecer en el campo \"facts\" con las URLs exactas de los resultados que lo respaldan. Un dato con una sola fuente no se usa: no lo completes, no lo estimes y no lo inventes; descríbelo en \"note\" solo si conviene avisar al usuario.",
      "Los datos que cambian con el tiempo (tablas de posiciones, puntos, marcadores, clasificaciones, rachas) exigen más cuidado: solo cuentan como respaldo fuentes publicadas o actualizadas en los últimos 7 días respecto a la fecha de referencia; una fuente con el estado anterior (la jornada pasada, la fecha de corte vieja) no respalda el dato actual. En \"value\" cita el corte temporal del dato (jornada o fecha: \"jornada 13, al 21 de octubre\") y márcalo con \"volatile\": true.",
      "Si las fuentes se contradicen en un valor (p. ej., puntos distintos para un mismo equipo), no elijas al azar ni promedies: gana la fuente más reciente que declare el corte temporal del dato; si el conflicto no se resuelve, no confirmes el dato y explícalo en \"note\".",
      "Cuando confirmes por separado un estado parcial y los resultados finales posteriores (p. ej., la tabla al inicio de la fecha en dos medios y el resultado final de un partido pendiente en otros dos), puedes combinarlos en un solo dato si la aritmética es trivial (sumar los puntos del resultado a la tabla): declara el corte en \"value\" (\"27 puntos al cierre de la jornada 13: 24 antes de vencer al Atlas\") y cita en \"sources\" las URLs de ambas piezas. Nunca combines si el cálculo no es directo.",
      "Para deportes y competencias prefiere la fuente oficial del organizador y los medios deportivos verificados: la Liga MX (ligamx.net), ESPN (espn.com.mx, espndeportes), Mediotiempo (mediotiempo.com), TUDN (tudn.com), Récord (record.com.mx) y Azteca Deportes (aztecadeportes.com); cuando la búsqueda dice que estuvo restringida a medios verificados, toda su evidencia viene de ellos. Desconfía de agregadores y páginas de pronósticos, quinielas o simuladores, que publican tablas proyectadas o desactualizadas, y de notas que hablen de una jornada o temporada distinta a la actual.",
      "Las fuentes que cites deben mostrar el dato en sí (la tabla, el resultado, la cifra), no solo tratar el tema: una ficha de partido individual o una nota de un solo encuentro no respalda una tabla de posiciones completa.",
      "En tablas de posiciones con equipos empatados en puntos, confirma los puntos de cada equipo pero no el orden exacto entre empatados salvo que una fuente oficial lo respalde: el desempate varía entre fuentes, así que redáctalo sin comprometer la posición y, si conviene, adviértelo en \"note\".",
      "Contrasta las fechas de publicación con la referencia temporal: para eventos próximos o pasados recientes prefiere las fuentes más recientes y desconfía de notas viejas que hablen de otro evento similar.",
      "Si la petición se apoya en algo que no ocurrió o no existe (por ejemplo, un partido que no es hoy), no lo inventes ni lo anuncies dentro del prompt: no escribas aclaraciones, notas ni avisos en el prompt; si es relevante para el usuario, descríbelo en el campo \"note\".",
      "Si la evidencia no alcanza para confirmar los datos que la petición necesita, redacta el prompt solo con la descripción del usuario y, si conviene avisarlo, explícalo en \"note\"."
    )
  } else {
    rules.push(
      "No tienes acceso a internet: reescribe la petición con lo que ya sabes y sé prudente con los datos que no puedas confirmar."
    )
  }

  rules.push(
    "Después reescribe la petición del usuario como un único prompt en español de México (es-MX), listo para generar una imagen: un párrafo descriptivo (máximo 120 palabras), sin comillas, sin listas, sin título y sin frases previas ni posteriores.",
    "Da salida solo a lo que el usuario pidió: no añadas elementos, escenas, símbolos, rótulos ni textos para representar en la imagen, ni datos o afirmaciones que no estén en su petición, aunque sean reales o los hayas encontrado en la búsqueda. La búsqueda solo sirve para completar los datos del tema pedido (fecha, hora, cifra, nombre, sede): si alguno es imprescindible para que la imagen sea fiel, inclúyelo, y nada más.",
    "El prompt debe mantener la intención del usuario e integrar de forma natural los datos confirmados del tema pedido, sin ampliar la escena ni los elementos descritos.",
    'Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones: {"facts": [{"value": string, "sources": string[], "volatile": boolean}], "prompt": string, "aspectRatio": "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3", "note": string}. "facts" es la lista de datos confirmados que integraste al prompt (vacía si no hubo): cada "value" es el dato en una frase corta en español de México (con su corte temporal —jornada o fecha— cuando cambia con el tiempo) y "sources" son entre 2 y 3 URLs exactas de resultados de familias editoriales distintas que lo respaldan; "volatile" es true cuando el dato cambia con el tiempo (tablas, marcadores, puntos, clasificaciones). El campo "note" es opcional: inclúyelo solo cuando la petición se apoye en un hecho que no ocurrió o no existe (por ejemplo, "hoy no hay ese partido"), o cuando la evidencia no alcanzó para confirmar un dato imprescindible, y escribe en él una sola frase breve en español de México; omítelo si no hace falta y no lo uses para comentar, explicar o justificar la respuesta.'
  )

  return rules.join(" ")
}

function userContent(input: PromptDetailsInput, evidenceText: string | null): string {
  const parts = [
    `Petición del usuario (puede venir en cualquier idioma; el resultado debe salir siempre en español de México): ${input.prompt}`,
    `Aspecto seleccionado: ${input.aspectRatio ?? "auto"}`,
  ]
  if (evidenceText) parts.push("", evidenceText)
  return parts.join("\n")
}

export function parseDetailsResponse(raw: string): {
  prompt: string
  aspectRatio: string | null
  note: string | null
  /** Lista de datos tal como los citó el modelo; se validan después. */
  facts: unknown
} | null {
  const parsed = parseJsonLoose(raw)
  if (typeof parsed !== "object" || parsed === null) return null
  const { prompt, aspectRatio, note, facts } = parsed as Record<string, unknown>
  if (typeof prompt !== "string") return null
  const trimmed = prompt.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DETAILS_PROMPT_LENGTH) {
    return null
  }
  const trimmedNote = typeof note === "string" ? note.trim() : ""
  return {
    prompt: trimmed,
    aspectRatio: typeof aspectRatio === "string" ? aspectRatio : null,
    note:
      trimmedNote.length > 0 && trimmedNote.length <= MAX_DETAILS_NOTE_LENGTH
        ? trimmedNote
        : null,
    facts,
  }
}

/*
 * ── Paso 4: validación determinista ───────────────────────────────────────
 */

/** Epoch de la fecha de publicación que reporta Tavily, o null si no hay
 * fecha o no se puede parsear. */
function parsePublishedDate(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

/** Fecha de publicación más reciente entre toda la evidencia (null si
 * ninguna fuente trae fecha): mide qué tan fresco es el corte disponible. */
function freshestEvidenceMs(outcome: ResearchOutcome): number | null {
  let freshest: number | null = null
  for (const source of outcome.index.values()) {
    const ts = parsePublishedDate(source.publishedDate)
    if (ts !== null && (freshest === null || ts > freshest)) freshest = ts
  }
  return freshest
}

/** Dato rechazado por la validación, con la causa: alimenta la
 * retroalimentación del re-intento correctivo. */
interface FactRejection {
  value: string
  reason: string
}

/*
 * Solo sobreviven los datos cuyas citas existen de verdad en los resultados
 * de Tavily (URLs inventadas se descartan) y que cuentan con al menos
 * MIN_FACT_SOURCES familias editoriales distintas (dos páginas del mismo
 * medio no valen). Los datos volátiles, además, necesitan al menos una
 * fuente reciente: si todas las fuentes fechadas son más viejas que la
 * ventana de frescura, el dato se descarta porque se corrobora con el
 * estado anterior. Las fuentes que llegan sin fecha se toleran (Tavily no
 * siempre la detecta). Las fuentes que se muestran al usuario son
 * exclusivamente las que respaldan datos confirmados.
 */
function validateFacts(
  rawFacts: unknown,
  index: Map<string, DetailsSource> | null
): { facts: DetailsFact[]; sources: DetailsSource[]; rejections: FactRejection[] } {
  const facts: DetailsFact[] = []
  const sources: DetailsSource[] = []
  const rejections: FactRejection[] = []
  if (!index || !Array.isArray(rawFacts)) return { facts, sources, rejections }

  const now = Date.now()
  const seenSources = new Set<string>()
  for (const entry of rawFacts) {
    if (facts.length >= MAX_FACTS) break
    const fact = entry as {
      value?: unknown
      sources?: unknown
      volatile?: unknown
    }
    const value = typeof fact.value === "string" ? fact.value.trim() : ""
    if (value.length === 0 || value.length > MAX_FACT_LENGTH) continue
    const urls = Array.isArray(fact.sources) ? fact.sources : []

    // Citas que existen en la evidencia (aunque repitan medio) y familias.
    const matched: DetailsSource[] = []
    const matchedUrls = new Set<string>()
    const families = new Set<string>()
    for (const url of urls) {
      if (typeof url !== "string") continue
      const source = index.get(normalizeUrl(url))
      if (!source || matchedUrls.has(source.url)) continue
      matchedUrls.add(source.url)
      matched.push(source)
      const domain = domainOf(source.url)
      if (domain) families.add(publisherFamilyOf(domain))
    }

    if (matched.length === 0) {
      rejections.push({
        value,
        reason: "ninguna de sus citas está en la evidencia real de la búsqueda",
      })
      continue
    }
    if (families.size < MIN_FACT_SOURCES) {
      rejections.push({
        value,
        reason: `solo una familia editorial (${[...families].join(", ")}): dos páginas del mismo medio no corroboran`,
      })
      continue
    }

    // Una fuente por familia, hasta el tope.
    const supporting: DetailsSource[] = []
    const usedFamilies = new Set<string>()
    for (const source of matched) {
      if (supporting.length >= MAX_SOURCES) break
      const domain = domainOf(source.url)
      if (!domain) continue
      const family = publisherFamilyOf(domain)
      if (usedFamilies.has(family)) continue
      usedFamilies.add(family)
      supporting.push(source)
    }

    if (fact.volatile === true) {
      const dated = matched
        .map((source) => parsePublishedDate(source.publishedDate))
        .filter((ts): ts is number => ts !== null)
      const hasFresh = dated.some((ts) => now - ts <= VOLATILE_FRESHNESS_MS)
      if (dated.length > 0 && !hasFresh) {
        rejections.push({
          value,
          reason: "dato volátil sin ninguna fuente publicada en la última semana",
        })
        continue
      }
    }

    facts.push({ value, sources: supporting })
    for (const source of supporting) {
      if (seenSources.has(source.url)) continue
      seenSources.add(source.url)
      if (sources.length < MAX_SOURCES) sources.push(source)
    }
  }

  return { facts, sources, rejections }
}

async function runDetailsModel(
  input: PromptDetailsInput,
  moment: MexicoCityMoment,
  options: {
    evidence: ResearchOutcome | null
    images: boolean
    /** Retroalimentación correctiva cuando el validador rechazó las citas
     * del intento anterior: se anexa al contenido para que el modelo
     * corrija las citas en lugar de repetirlas. */
    feedback?: string
  }
): Promise<{
  raw: string
  finishReason: string | null
  index: Map<string, DetailsSource> | null
}> {
  const base = userContent(input, options.evidence?.text ?? null)
  const content: (
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: Uint8Array }
  )[] = [
    {
      type: "text",
      text: options.feedback ? `${base}\n\n${options.feedback}` : base,
    },
  ]

  if (options.images) {
    for (const image of input.referenceImages ?? []) {
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.bytes,
      })
    }
  }

  const result = await generateText({
    model: gateway.languageModel(resolveModel()),
    system: systemPrompt(moment, options.evidence !== null),
    messages: [{ role: "user", content }],
    maxOutputTokens: DETAILS_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
  })

  return {
    raw: result.text,
    finishReason: result.finishReason,
    index: options.evidence?.index ?? null,
  }
}

/** Mensaje correctivo para el re-intento: dice qué dato cayó y por qué. */
function buildCorrectionFeedback(rejections: FactRejection[]): string {
  const detail = rejections
    .slice(0, 8)
    .map((rejection) => `- «${rejection.value.slice(0, 120)}»: ${rejection.reason}`)
    .join("\n")
  return [
    "CORRECCIÓN OBLIGATORIA: el validador del servidor rechazó todos los datos del intento anterior:",
    detail,
    "Responde de nuevo el JSON completo. Cada dato debe citar dos resultados de familias editoriales distintas que aparezcan en la evidencia (dos páginas del mismo medio no valen; usa otras páginas de la evidencia, no repitas citas rechazadas). Si la evidencia no lo permite, devuelve \"facts\": [] y explica la carencia en \"note\".",
  ].join("\n")
}

/*
 * La investigación (plan + Tavily) se intenta una sola vez: si falla, se
 * degrada a redacción sin datos externos. La síntesis conserva su cadena de
 * reintentos —con evidencia, sin imágenes y, como último recurso, sin
 * investigación— para no dejar al usuario sin resultado.
 */
export async function buildPromptWithDetails(
  input: PromptDetailsInput
): Promise<PromptDetailsResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new AppError(
      500,
      "details_not_configured",
      "La inserción de detalles no está configurada en el servidor (falta AI_GATEWAY_API_KEY)."
    )
  }

  // La fecha y la hora de referencia se validan una sola vez: si no se
  // pueden verificar, el error sale claro en vez de reintentarse.
  const moment = mexicoCityNow()

  const hasImages = (input.referenceImages?.length ?? 0) > 0

  let research: ResearchOutcome | null = null
  if (tavilyConfigured()) {
    try {
      research = await researchWithTavily(input, moment)
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: details research failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  } else {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: "images: TAVILY_API_KEY no está configurada; la inserción de detalles continúa sin investigación web",
      })
    )
  }

  const queue: { evidence: ResearchOutcome | null; images: boolean; feedback?: string }[] =
    research
      ? [
          { evidence: research, images: hasImages },
          { evidence: research, images: false },
          // Reintento de respaldo con la misma evidencia: un JSON truncado o
          // una respuesta vacía no deben tirar toda la investigación.
          { evidence: research, images: false },
          { evidence: null, images: hasImages },
          { evidence: null, images: false },
        ]
      : [
          { evidence: null, images: hasImages },
          { evidence: null, images: false },
        ]

  // Una ronda de refinamiento: si la síntesis con evidencia no confirmó
  // nada y el plan era volátil, se buscan los huecos y se re-sintetiza.
  let refinementsLeft = 1
  // Una re-síntesis correctiva: cuando el validador rechazó las citas (dos
  // páginas del mismo medio, URLs fuera de la evidencia), el modelo recibe
  // la causa exacta y corrige sus citas.
  let correctionsLeft = 1

  while (queue.length > 0) {
    const attempt = queue.shift()!
    try {
      const { raw, finishReason, index } = await runDetailsModel(input, moment, attempt)
      const parsed = parseDetailsResponse(raw)
      if (!parsed) {
        throw new Error(
          `respuesta del modelo no válida (finish=${finishReason ?? "?"}): ${raw
            .trim()
            .slice(0, 400)
            .replace(/\s+/g, " ")}`
        )
      }
      const { facts, sources, rejections } = validateFacts(parsed.facts, index)

      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          info: "images: details synthesis",
          research: attempt.evidence !== null,
          images: attempt.images,
          correction: Boolean(attempt.feedback),
          facts: facts.length,
          rejected: rejections.length,
        })
      )

      // Correctivo: el modelo intentó confirmar pero el validador rechazó
      // todas las citas; se re-sintetiza con la causa antes de degradar.
      if (
        facts.length === 0 &&
        rejections.length > 0 &&
        attempt.evidence !== null &&
        !attempt.feedback &&
        correctionsLeft > 0
      ) {
        correctionsLeft -= 1
        queue.unshift({
          evidence: attempt.evidence,
          images: attempt.images,
          feedback: buildCorrectionFeedback(rejections),
        })
        continue
      }

      // Ronda de refinamiento: nada confirmado (o evidencia con horas) y
      // datos volátiles: se buscan los huecos y se re-sintetiza.
      const freshest = attempt.evidence
        ? freshestEvidenceMs(attempt.evidence)
        : null
      const evidenceStale =
        freshest !== null && Date.now() - freshest > STALE_EVIDENCE_MS

      if (
        attempt.evidence !== null &&
        attempt.evidence.volatile &&
        refinementsLeft > 0 &&
        (facts.length === 0 || evidenceStale)
      ) {
        try {
          const refined = await refineResearch(
            input,
            moment,
            attempt.evidence,
            parsed.note
          )
          if (refined) {
            refinementsLeft -= 1
            queue.unshift({ evidence: refined, images: attempt.images })
            continue
          }
        } catch (error) {
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              error: `images: details refinement failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            })
          )
        }
      }

      // Hubo investigación pero ningún dato alcanzó las dos fuentes: el
      // aviso estándar deja claro que el prompt no lleva datos verificados.
      const note =
        parsed.note ??
        (attempt.evidence && facts.length === 0
          ? "No pude confirmar los datos de la búsqueda con al menos dos fuentes independientes; el prompt usa solo tu descripción."
          : null)
      return { ...parsed, note, sources, facts }
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: details failed (research=${attempt.evidence !== null}, images=${attempt.images}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  }

  throw new AppError(
    502,
    "details_error",
    "No se pudieron obtener los detalles del tema. Inténtalo de nuevo en unos momentos."
  )
}
