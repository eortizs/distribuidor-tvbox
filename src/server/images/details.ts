import { generateText } from "ai"
import { gateway } from "@ai-sdk/gateway"

import { AppError } from "@/server/umejson/types"

/**
 * "Insertar detalles": el modelo interpreta la petición del usuario, la
 * investiga en internet (búsqueda web del AI Gateway) y devuelve un único
 * prompt listo para generar la imagen, con los datos encontrados integrados.
 */

const DEFAULT_DETAILS_MODEL = "anthropic/claude-haiku-5.5"
const DETAILS_TIMEOUT_MS = 60_000
const DETAILS_MAX_OUTPUT_TOKENS = 2000
const MAX_DETAILS_PROMPT_LENGTH = 2000
const MAX_SOURCES = 8
const MAX_DETAILS_NOTE_LENGTH = 400

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
  sources: DetailsSource[]
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

/*
 * Con búsqueda: el modelo investiga primero y luego redacta el prompt final.
 * Sin búsqueda (respaldo): solo reescribe con lo que ya sabe.
 */
function systemPrompt(
  moment: MexicoCityMoment,
  withResearch: boolean
): string {
  const rules = [
    "Eres el director de arte de la herramienta de imágenes del panel de Distribuidor TVBox.",
    `Referencia temporal: ahora en Ciudad de México (${moment.offsetLabel}) es ${moment.long}, ${moment.time} (fecha ISO: ${moment.iso}). Resuelve referencias como "hoy", "esta noche" o "el próximo partido" con esa fecha y con los resultados de la búsqueda.`,
    "Maneja los horarios exclusivamente en hora del centro de México (Ciudad de México). Traduce a esa zona cualquier hora que encuentres y no agregues la zona ni la hora local de origen: escribe solo la hora de Ciudad de México (por ejemplo, \"19:00\"), sin \"hora local\", sin \"GMT\" y sin nombrar la ciudad de origen.",
    "Todo lo que escribas va siempre en español de México (es-MX), sin excepción, aunque el usuario te escriba en otro idioma: si su petición está en inglés o en otro idioma, tradúcela al español de México. Usa el léxico y las referencias propias de México (\"El Tri\", \"la Selección Mexicana\", \"liga MX\", \"el里亚\", \"el albañil\"), nunca otra variante regional del español (por ejemplo, \"ordenador\", \"coche\", \"vosotros\") ni otro idioma.",
  ]

  if (withResearch) {
    rules.push(
      "Primero investiga en internet los datos concretos que la petición necesita: fechas, horarios, cifras, eventos, nombres propios o cualquier detalle actual. Si la petición alude a algo puntual o reciente (por ejemplo, \"el partido de hoy\"), busca los datos reales y comprueba las fechas.",
      "Haz las búsquedas en español de México (es-MX), con los nombres propios como los usa aquí (por ejemplo, \"Selección Mexicana\" o \"El Tri\"), para que los resultados y las fuentes sean los de México.",
      "Si la petición se apoya en algo que no ocurrió o no existe (por ejemplo, un partido que no es hoy), no lo inventes ni lo anuncies dentro del prompt: no escribas aclaraciones, notas ni avisos en el prompt; si es relevante para el usuario, descríbelo en el campo \"note\"."
    )
  } else {
    rules.push(
      "No tienes acceso a internet: reescribe la petición con lo que ya sabes y sé prudente con los datos que no puedas confirmar."
    )
  }

  rules.push(
    "Después reescribe la petición del usuario como un único prompt en español de México (es-MX), listo para generar una imagen: un párrafo descriptivo (máximo 120 palabras), sin comillas, sin listas, sin título y sin frases previas ni posteriores.",
    "Da salida solo a lo que el usuario pidió: no añadas elementos, escenas, símbolos, rótulos ni textos para representar en la imagen, ni datos o afirmaciones que no estén en su petición, aunque sean reales o los hayas encontrado en la búsqueda. La búsqueda solo sirve para completar los datos del tema pedido (fecha, hora, cifra, nombre, sede): si alguno es imprescindible para que la imagen sea fiel, inclúyelo, y nada más.",
    "El prompt debe mantener la intención del usuario e integrar de forma natural los datos averiguados del tema pedido, sin ampliar la escena ni los elementos descritos.",
    "Si la búsqueda no devuelve datos fiables, no inventes: describe solo lo que el usuario pidió.",
    'Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones: {"prompt": string, "aspectRatio": "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3", "note": string}. El campo "note" es opcional: inclúyelo solo cuando la petición se apoye en un hecho que no ocurrió o no existe (por ejemplo, "hoy no hay ese partido"), y escribe en él una sola frase breve en español de México; omítelo si no hace falta y no lo uses para comentar, explicar o justificar la respuesta.'
  )

  return rules.join(" ")
}

function userContent(input: PromptDetailsInput): string {
  return [
    `Petición del usuario (puede venir en cualquier idioma; el resultado debe salir siempre en español de México): ${input.prompt}`,
    `Aspecto seleccionado: ${input.aspectRatio ?? "auto"}`,
  ].join("\n")
}

/*
 * Extrae las URLs consultadas por la herramienta de búsqueda para poder
 * mostrarlas al usuario: la investigación queda trazable.
 */
function extractSources(toolResults: unknown): DetailsSource[] {
  const sources: DetailsSource[] = []
  const seen = new Set<string>()
  const results = Array.isArray(toolResults)
    ? (toolResults as { output?: unknown }[])
    : []

  for (const toolResult of results) {
    const output = toolResult?.output as
      | { web_results?: { title?: string; url?: string }[] }
      | undefined
    for (const entry of output?.web_results ?? []) {
      const url = entry.url?.trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      const title = entry.title?.trim()
      sources.push({ title: title && title.length > 0 ? title : url, url })
      if (sources.length >= MAX_SOURCES) return sources
    }
  }

  return sources
}

export function parseDetailsResponse(raw: string): {
  prompt: string
  aspectRatio: string | null
  note: string | null
} | null {
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
  const { prompt, aspectRatio, note } = parsed as Record<string, unknown>
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
  }
}

async function runDetailsModel(
  input: PromptDetailsInput,
  moment: MexicoCityMoment,
  options: { research: boolean; images: boolean }
): Promise<{ raw: string; sources: DetailsSource[] }> {
  const content: (
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: Uint8Array }
  )[] = [{ type: "text", text: userContent(input) }]

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
    system: systemPrompt(moment, options.research),
    messages: [{ role: "user", content }],
    ...(options.research
      ? {
          tools: {
            web_search: gateway.tools.takoSearch({
              effort: "fast",
              // La búsqueda se ancla en México: fuentes y contexto en es-MX.
              countryCode: "MX",
              locale: "es-MX",
              timezone: "America/Mexico_City",
              sources: { web: { count: 5 } },
            }),
          },
        }
      : {}),
    maxOutputTokens: DETAILS_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
  })

  return { raw: result.text, sources: extractSources(result.toolResults) }
}

/*
 * La búsqueda puede fallar (proveedor sin búsqueda, timeout, JSON inválido) y
 * las referencias pueden no ser compatibles con el modelo: se degrada por
 * pasos —con búsqueda, sin búsqueda y, como último recurso, sin imágenes— en
 * vez de dejar al usuario sin resultado.
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
  const attempts: { research: boolean; images: boolean }[] = [
    { research: true, images: hasImages },
    { research: true, images: false },
    { research: false, images: hasImages },
    { research: false, images: false },
  ]

  for (const attempt of attempts) {
    try {
      const { raw, sources } = await runDetailsModel(input, moment, attempt)
      const parsed = parseDetailsResponse(raw)
      if (!parsed) {
        throw new Error("respuesta del modelo no válida")
      }
      return { ...parsed, sources }
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: details failed (research=${attempt.research}, images=${attempt.images}): ${
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
