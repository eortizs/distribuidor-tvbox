/**
 * Server lifecycle hook de Next.js: se ejecuta una vez al iniciar cada
 * instancia del servidor. Aquí arrancan los procesos de fondo del panel.
 *
 * - Scheduler de cumplimiento de renovaciones: ejecuta los reintentos
 *   automáticos agendados tras fallos transitorios del panel de licencias
 *   (el pago ya está confirmado; la renovación se auto-sanaría con backoff)
 *   y rescata órdenes `paid` varadas por un corte del proceso.
 * - Scheduler del módulo Alertas: revisa cada minuto las alertas de búsqueda
 *   vencidas (grounding) y dispara recordatorios.
 *
 * Import dinámico dentro del guard de runtime: nada de pool de Postgres en
 * el runtime de edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { startRenewalRetryScheduler } = await import(
    "@/server/mercadopago/renewal-scheduler"
  )
  startRenewalRetryScheduler()
  const { startAlertasScheduler } = await import(
    "@/server/alertas/scheduler"
  )
  startAlertasScheduler()
}
