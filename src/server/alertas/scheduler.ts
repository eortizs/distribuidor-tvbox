import { alertasSchedulerTick } from "./service"

/**
 * Timer en proceso del módulo Alertas: revisa cada minuto las alertas
 * vencidas (búsquedas con grounding y recordatorios) y dispara sus avisos.
 * El servidor es un único Node bajo pm2 (`next start`), así que un intervalo
 * basta; el guard `ticking` evita solapar pasadas porque cada revisión puede
 * tardar decenas de segundos (búsqueda con grounding).
 *
 * Arranque: `src/instrumentation.ts` (hook `register` de Next.js, runtime
 * Node). Los recordatorios piden precisión de minuto: el tick es de 60 s.
 */

const TICK_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await alertasSchedulerTick()
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `alertas: scheduler: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  } finally {
    ticking = false
  }
}

/** Arranca el scheduler una sola vez por proceso (idempotente). */
export function startAlertasScheduler(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  // Node: el timer no debe mantener vivo el proceso por sí solo (builds,
  // scripts); en runtime el servidor pm2 ya lo mantiene arriba.
  const handle = timer as unknown as { unref?: () => void }
  handle.unref?.()
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "alertas.scheduler_started",
      tick_ms: TICK_MS,
    })
  )
}
