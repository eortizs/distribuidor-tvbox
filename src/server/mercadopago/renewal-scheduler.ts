import { renewalSchedulerTick } from "./service"

/**
 * Timer en proceso que cumple renovaciones agendadas: reintentos automáticos
 * tras fallos transitorios del panel (timeout, red, cooldown) y órdenes
 * `paid` varadas por un corte del proceso. El servidor es un único Node bajo
 * pm2 (`next start`), así que un intervalo basta (los delays de backoff son
 * de minutos); el guard `ticking` evita solapar pasadas cuando el panel está
 * lento, porque cada intento puede tardar decenas de segundos.
 *
 * Arranque: `src/instrumentation.ts` (hook `register` de Next.js, runtime
 * Node). La conciliación por lectura (`reconcilePendingOrder`) sigue de
 * respaldo si el scheduler no está corriendo.
 */

const TICK_MS = 30_000

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await renewalSchedulerTick()
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `mercadopago: renewal scheduler: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  } finally {
    ticking = false
  }
}

/** Arranca el scheduler una sola vez por proceso (idempotente). */
export function startRenewalRetryScheduler(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  // Node: el timer no debe mantener vivo el proceso por sí solo (builds,
  // scripts); en runtime el servidor pm2 ya lo mantiene arriba.
  const handle = timer as unknown as { unref?: () => void }
  handle.unref?.()
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "mercadopago.renewal_scheduler_started",
      tick_ms: TICK_MS,
    })
  )
}
