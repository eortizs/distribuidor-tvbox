/**
 * Dominio del módulo Alertas compartido por cliente y servidor: catálogo de
 * frecuencias, límites y validadores estrictos de la especificación que el
 * LLM interpreta desde lenguaje natural. El servidor es la única puerta de
 * escritura: cualquier spec que llegue por la API pasa por
 * `normalizeAlertSpec` antes de tocar la base.
 */

export const ALERT_FREQUENCIES = [
  "hourly",
  "6h",
  "12h",
  "daily",
  "weekly",
] as const

export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number]

export const FREQUENCY_LABELS: Record<AlertFrequency, string> = {
  hourly: "Cada hora",
  "6h": "Cada 6 horas",
  "12h": "Cada 12 horas",
  daily: "Diario",
  weekly: "Semanal",
}

/** Horas entre revisiones, para las frecuencias por intervalo. */
export const FREQUENCY_INTERVAL_HOURS: Record<
  AlertFrequency,
  number | null
> = {
  hourly: 1,
  "6h": 6,
  "12h": 12,
  daily: null,
  weekly: null,
}

export const ALERT_KINDS = ["search", "reminder"] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const ALERT_MODES = ["once", "recurring"] as const
export type AlertMode = (typeof ALERT_MODES)[number]

export const ALERT_STATUSES = [
  "active",
  "paused",
  "done",
  "error",
] as const
export type AlertStatus = (typeof ALERT_STATUSES)[number]

export const STATUS_LABELS: Record<AlertStatus, string> = {
  active: "Activa",
  paused: "Pausada",
  done: "Completada",
  error: "Con errores",
}

/** Alertas activas por usuario: cada revisión cuesta una búsqueda con
 * grounding, así que el catálogo tiene techo. */
export const MAX_ALERTS_PER_USER = 10

/** Tope del texto en lenguaje natural (escrito o dictado). */
export const MAX_ALERT_TEXT = 1000

/** Tope del título que redacta el LLM. */
export const MAX_ALERT_TITLE = 80

/** Tope de la consulta de búsqueda que redacta el LLM. */
export const MAX_ALERT_QUERY = 300

/** Hora por omisión para daily/weekly cuando el usuario no la dijo. */
export const DEFAULT_TIME_OF_DAY = "09:00"

/** Fallos consecutivos del LLM que pausan una alerta (status 'error'). */
export const MAX_ALERT_ERRORS = 3

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value)
}

export function isValidWeekday(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6
}

export function isValidAlertKind(value: unknown): value is AlertKind {
  return typeof value === "string" && (ALERT_KINDS as readonly string[]).includes(value)
}

export function isValidAlertMode(value: unknown): value is AlertMode {
  return typeof value === "string" && (ALERT_MODES as readonly string[]).includes(value)
}

export function isValidAlertFrequency(value: unknown): value is AlertFrequency {
  return (
    typeof value === "string" && (ALERT_FREQUENCIES as readonly string[]).includes(value)
  )
}

export const WEEKDAY_LABELS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const

/** Especificación estructurada de una alerta. */
export interface AlertSpec {
  kind: AlertKind
  title: string
  /** Consulta de búsqueda (solo kind search), es-MX, sin referencias relativas. */
  query: string | null
  frequency: AlertFrequency | null
  /** HH:mm en Ciudad de México (daily/weekly). */
  timeOfDay: string | null
  /** 0 = domingo … 6 = sábado (weekly). */
  weekday: number | null
  mode: AlertMode | null
  /** ISO 8601 con offset (solo reminder); debe quedar en el futuro. */
  remindAt: string | null
}

export type NormalizedSpec =
  | { ok: true; spec: AlertSpec }
  | { ok: false; error: string }

/**
 * Valida y normaliza la spec de una alerta (la que devuelve el LLM o la que
 * el cliente confirma tras editar el preview). Todo lo que no cumpla el
 * catálogo se rechaza con un motivo legible: nunca se "repara" a medias.
 */
export function normalizeAlertSpec(input: unknown): NormalizedSpec {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "La alerta no tiene la forma esperada." }
  }
  const raw = input as Record<string, unknown>

  if (!isValidAlertKind(raw.kind)) {
    return { ok: false, error: "La alerta debe ser de búsqueda o recordatorio." }
  }

  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_ALERT_TITLE) : ""
  if (title.length === 0) {
    return { ok: false, error: "La alerta necesita un título." }
  }

  if (raw.kind === "search") {
    const query =
      typeof raw.query === "string" ? raw.query.trim().slice(0, MAX_ALERT_QUERY) : ""
    if (query.length === 0) {
      return { ok: false, error: "A la alerta de búsqueda le falta la consulta." }
    }
    if (!isValidAlertFrequency(raw.frequency)) {
      return { ok: false, error: "Elige con qué frecuencia revisar la alerta." }
    }
    const frequency = raw.frequency
    let timeOfDay = isValidTimeOfDay(raw.timeOfDay) ? raw.timeOfDay : null
    let weekday = isValidWeekday(raw.weekday) ? raw.weekday : null
    if (frequency === "daily" || frequency === "weekly") {
      timeOfDay = timeOfDay ?? DEFAULT_TIME_OF_DAY
    } else {
      timeOfDay = null
      weekday = null
    }
    if (frequency === "weekly" && weekday === null) {
      return { ok: false, error: "Elige el día de la semana para revisar la alerta." }
    }
    if (!isValidAlertMode(raw.mode)) {
      return { ok: false, error: "Define si la alerta es única o recurrente." }
    }
    return {
      ok: true,
      spec: {
        kind: "search",
        title,
        query,
        frequency,
        timeOfDay,
        weekday,
        mode: raw.mode,
        remindAt: null,
      },
    }
  }

  // Recordatorio: fecha/hora exacta en el futuro (tolera 60 s de reloj).
  const remindRaw = typeof raw.remindAt === "string" ? raw.remindAt.trim() : ""
  const parsed = remindRaw ? Date.parse(remindRaw) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      error: "No pude entender la fecha y hora del recordatorio. Revísalas.",
    }
  }
  if (parsed <= Date.now() + 60_000) {
    return {
      ok: false,
      error: "La fecha del recordatorio ya pasó: elige un momento futuro.",
    }
  }
  return {
    ok: true,
    spec: {
      kind: "reminder",
      title,
      query: null,
      frequency: null,
      timeOfDay: null,
      weekday: null,
      mode: null,
      remindAt: new Date(parsed).toISOString(),
    },
  }
}

/*
 * ── Cálculo de la próxima revisión en Ciudad de México ─────────────────
 *
 * El scheduler trabaja en UTC; las horas que elige el usuario son de la
 * Ciudad de México. El desfase de la zona se lee con Intl para cada
 * candidato, de modo que un cambio de offset futuro (hoy la CDMX es UTC-6
 * fijo) no rompa el cálculo.
 */

const ALERTS_TZ = "America/Mexico_City"

/** Desfase en milisegundos de la zona respecto a UTC en un instante dado. */
function tzOffsetMs(atMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts: Record<string, number> = {}
  for (const part of dtf.formatToParts(new Date(atMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  )
  return asUtc - atMs
}

/** Siguiente ocurrencia local (hora y minuto del día) a partir de `fromMs`. */
function nextLocalTime(
  hour: number,
  minute: number,
  fromMs: number,
  fromWeekday?: number
): number {
  const offset = tzOffsetMs(fromMs, ALERTS_TZ)
  const local = new Date(fromMs + offset)
  const base = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    hour,
    minute,
    0
  )
  let dayShift = 0
  if (fromWeekday !== undefined) {
    const currentWeekday = local.getUTCDay()
    dayShift = (fromWeekday - currentWeekday + 7) % 7
  }
  let candidateLocal = base + dayShift * 24 * 60 * 60 * 1000
  let candidateUtc = candidateLocal - offset
  if (candidateUtc <= fromMs) {
    // La hora ya pasó hoy: daily avanza 1 día y weekly 7 (el candidato era
    // el día objetivo con `dayShift` 0); reprogramar al día siguiente haría
    // que una alerta semanal se dispare dos veces por semana.
    candidateLocal += (fromWeekday !== undefined ? 7 : 1) * 24 * 60 * 60 * 1000
    // El desfase se recalcula para el día candidato (cambio de offset).
    const candidateOffset = tzOffsetMs(candidateLocal - offset, ALERTS_TZ)
    candidateUtc = candidateLocal - candidateOffset
  }
  return candidateUtc
}

/**
 * Próxima revisión de una alerta de búsqueda en UTC (ms), a partir de
 * `fromMs`. `hourly`/`6h`/`12h` avanzan por intervalo; `daily` cae en la
 * hora elegida y `weekly` en el día + hora elegidos, ambos en hora de la
 * Ciudad de México.
 */
export function nextCheckFrom(
  frequency: AlertFrequency,
  timeOfDay: string,
  weekday: number | null,
  fromMs: number
): number {
  const interval = FREQUENCY_INTERVAL_HOURS[frequency]
  if (interval !== null) {
    return fromMs + interval * 60 * 60 * 1000
  }
  const [hour, minute] = timeOfDay.split(":").map(Number)
  if (frequency === "weekly" && weekday !== null) {
    return nextLocalTime(hour, minute, fromMs, weekday)
  }
  return nextLocalTime(hour, minute, fromMs)
}
