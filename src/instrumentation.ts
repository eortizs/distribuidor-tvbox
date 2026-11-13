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
 * - Gateway WhatsApp (Baileys): vincula el número del agente IA como
 *   dispositivo, espeja la campana de notificaciones y atiende el chat de
 *   consultas. Sin `WHATSAPP_AGENT_NUMBER` queda deshabilitado.
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
  // El gateway es opcional: un fallo (auth corrupta, red caída) jamás debe
  // impedir que el servidor arranque — se registra y el panel sigue arriba.
  try {
    const { startWhatsAppGateway } = await import("@/server/whatsapp/socket")
    await startWhatsAppGateway()
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `whatsapp: gateway_boot_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }
}
