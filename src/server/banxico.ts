/*
 * Banxico FIX exchange rate (serie SF43718): MXN per USD.
 *
 * The FIX rate is published on banking days only, so each calendar day is
 * served with the last value published on or before it. Rates are fetched as
 * a date range and cached in memory (forward-filled per calendar day), which
 * keeps the number of API calls to one per hour at most.
 */

const BANXICO_BASE_URL =
  "https://www.banxico.org.mx/SieAPIRest/service/v1/series"
const FIX_SERIE = "SF43718"
const REFRESH_TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000
// Costs accrue to the user's calendar day, not the server's UTC day.
const MX_TIME_ZONE = "America/Mexico_City"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MX_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Calendar day (yyyy-mm-dd) of an instant in Mexico City time. */
export function mxDayKey(date: Date): string {
  return dayKeyFormatter.format(date)
}

export interface FixRateInfo {
  day: string
  rate: number
}

interface SeriesPoint {
  fecha: string
  dato: string
}

interface RateCache {
  // yyyy-mm-dd -> rate, present for every day in [firstDay, lastDay]
  rates: Map<string, number>
  firstDay: string
  lastDay: string
  lastPublished: FixRateInfo
  fetchedAt: number
}

let cache: RateCache | null = null
let inflight: Promise<void> | null = null

function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function pointDay(fecha: string): string {
  const [d, m, y] = fecha.split("/")
  return `${y}-${m}-${d}`
}

async function fetchFixSeries(from: string, to: string): Promise<SeriesPoint[]> {
  const token = process.env.BANXICO_TOKEN
  if (!token) throw new Error("banxico: BANXICO_TOKEN is not set")
  const response = await fetch(
    `${BANXICO_BASE_URL}/${FIX_SERIE}/datos/${from}/${to}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Bmx-Token": token, Accept: "application/json" },
    }
  )
  if (!response.ok) throw new Error(`banxico: HTTP ${response.status}`)
  const payload = (await response.json().catch(() => null)) as {
    bmx?: { series?: { datos?: SeriesPoint[] }[] }
  } | null
  const points = payload?.bmx?.series?.[0]?.datos
  if (!Array.isArray(points)) throw new Error("banxico: unexpected payload")
  return points
}

function buildCache(points: SeriesPoint[], from: string, to: string):
  | RateCache
  | null {
  const parsed = points
    .map((point) => ({
      day: pointDay(point.fecha),
      rate: Number(String(point.dato).replace(",", ".")),
    }))
    .filter(
      (point) =>
        DAY_RE.test(point.day) && Number.isFinite(point.rate) && point.rate > 0
    )
    .sort((a, b) => compareDays(a.day, b.day))
  if (parsed.length === 0) return null

  const firstDay =
    compareDays(parsed[0].day, from) < 0 ? parsed[0].day : from
  const rates = new Map<string, number>()
  let index = 0
  let current = parsed[0].rate
  for (let day = firstDay; compareDays(day, to) <= 0; day = addDays(day, 1)) {
    while (index < parsed.length && compareDays(parsed[index].day, day) <= 0) {
      current = parsed[index].rate
      index += 1
    }
    rates.set(day, current)
  }
  const last = parsed[parsed.length - 1]
  return {
    rates,
    firstDay,
    lastDay: to,
    lastPublished: { day: last.day, rate: last.rate },
    fetchedAt: Date.now(),
  }
}

// Padded fetch window: a range with no banking day (e.g. a pure weekend)
// returns no data at all, so always reach back past the last publication.
const FETCH_PAD_DAYS = 10
// While Banxico is failing, serve null rates (USD fallback) instead of
// stalling every request with a fresh network attempt.
const FAILURE_COOLDOWN_MS = 60_000

let lastFailureAt = 0

function covered(minDay: string, today: string): boolean {
  return (
    cache !== null &&
    Date.now() - cache.fetchedAt < REFRESH_TTL_MS &&
    compareDays(cache.firstDay, minDay) <= 0 &&
    compareDays(cache.lastDay, today) >= 0
  )
}

async function ensureCache(minDay: string, maxDay: string): Promise<void> {
  const today = mxDayKey(new Date())
  // Loop until this caller's range is covered; the failure cooldown is the
  // only early exit, so a caller that keeps joining narrower in-flight
  // fetches eventually issues its own. The attempt cap is a defensive bound.
  for (let attempt = 0; attempt < 3 && !covered(minDay, today); attempt++) {
    if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) return
    if (!inflight) {
      const from =
        cache && compareDays(cache.firstDay, minDay) < 0
          ? cache.firstDay
          : minDay
      const to = compareDays(maxDay, today) > 0 ? maxDay : today
      const fetchFrom = addDays(from, -FETCH_PAD_DAYS)
      inflight = fetchFixSeries(fetchFrom, to)
        .then((points) => {
          const next = buildCache(points, fetchFrom, to)
          if (!next) {
            // 200 with an unusable payload: engage the cooldown too.
            throw new Error("banxico: empty or invalid series data")
          }
          cache = next
          lastFailureAt = 0
        })
        .catch((error: unknown) => {
          lastFailureAt = Date.now()
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              error: `banxico: ${error instanceof Error ? error.message : String(error)}`,
            })
          )
        })
        .finally(() => {
          inflight = null
        })
    }
    await inflight
  }
}

function lookup(day: string): number | null {
  if (!cache) return null
  if (compareDays(day, cache.firstDay) < 0) return null
  if (compareDays(day, cache.lastDay) > 0) return null
  return cache.rates.get(day) ?? null
}

/*
 * FIX rate per calendar day plus the latest published value. Days without a
 * known rate (Banxico unavailable or day beyond the series) map to null;
 * callers must degrade gracefully instead of failing the request.
 */
export async function fixRates(days: string[]): Promise<{
  rates: Map<string, number | null>
  latest: FixRateInfo | null
}> {
  const unique = [...new Set(days.filter((day) => DAY_RE.test(day)))].sort()
  const rates = new Map<string, number | null>(
    unique.map((day) => [day, null])
  )
  if (unique.length === 0) return { rates, latest: null }

  const today = mxDayKey(new Date())
  const minDay = unique[0]
  const maxDay = compareDays(unique[unique.length - 1], today) > 0
    ? unique[unique.length - 1]
    : today
  await ensureCache(minDay, maxDay)

  for (const day of unique) rates.set(day, lookup(day))
  return { rates, latest: cache ? cache.lastPublished : null }
}
