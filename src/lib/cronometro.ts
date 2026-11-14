/**
 * Lógica pura del módulo Cronómetro (`/modulos/cronometro`): formateo de
 * tiempos, utilidades del temporizador y estadísticas de vueltas. Sin React
 * para que las reglas sean fáciles de razonar y de probar.
 */

/** Límite de duración del temporizador: 23 h 59 min 59 s. */
export const TIMER_MAX_MS = 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000

/** Pasos de los presets de minutos que llenan el temporizador al toque. */
export const TIMER_PRESET_MINUTES = [1, 3, 5, 10, 15, 30] as const

/** Estado común de marcha de cronómetro y temporizador. */
export type RunStatus = "idle" | "running" | "paused"

/**
 * Tiempo transcurrido del cronómetro: centésimas visibles; la hora solo
 * aparece cuando hace falta. `04:12.58` → `1:04:12.58`.
 */
export function formatStopwatchMs(ms: number): string {
  const safe = Math.max(0, ms)
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1000)
  const centiseconds = Math.floor((safe % 1000) / 10)
  const mm = String(minutes).padStart(2, "0")
  const ss = String(seconds).padStart(2, "0")
  const cc = String(centiseconds).padStart(2, "0")
  return hours > 0
    ? `${hours}:${mm}:${ss}.${cc}`
    : `${mm}:${ss}.${cc}`
}

/** Cuenta regresiva del temporizador: `04:59` → `1:04:59`, `00:00` al terminar. */
export function formatTimerMs(ms: number): string {
  const safe = Math.max(0, ms)
  const totalSeconds = Math.ceil(safe / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, "0")
  const ss = String(seconds).padStart(2, "0")
  return hours > 0
    ? `${hours}:${mm}:${ss}`
    : `${mm}:${ss}`
}

/** Etiqueta compacta para el anuncio del temporizador: «5 min», «1 h 30 min». */
export function formatTimerLabel(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/**
 * Vuelta registrada por el cronómetro: tiempo de la vuelta sola y tiempo
 * total acumulado hasta ella.
 */
export interface Lap {
  id: number
  /** Duración de la vuelta sola, en ms. */
  lapMs: number
  /** Tiempo total acumulado del cronómetro al registrarla, en ms. */
  totalMs: number
}

/** Rótulos de las vueltas destacadas: más rápida y más lenta del conjunto. */
export interface LapMarkers {
  fastestId: number | null
  slowestId: number | null
}

/**
 * Marca la vuelta más rápida y la más lenta; con menos de dos vueltas no hay
 * comparación posible y no marca nada.
 */
export function lapMarkers(laps: Lap[]): LapMarkers {
  if (laps.length < 2) return { fastestId: null, slowestId: null }
  let fastest = laps[0]
  let slowest = laps[0]
  for (const lap of laps) {
    if (lap.lapMs < fastest.lapMs) fastest = lap
    if (lap.lapMs > slowest.lapMs) slowest = lap
  }
  return { fastestId: fastest.id, slowestId: slowest.id }
}

/**
 * Lee el valor de un campo numérico del temporizador: acepta vacío como 0,
 * recorta decimales y negativos, y topea en `max`.
 */
export function coerceTimerField(value: string, max: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.min(parsed, max)
}
