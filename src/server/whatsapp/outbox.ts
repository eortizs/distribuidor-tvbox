import { pool, withTransaction } from "@/server/db"
import { publicSiteUrl } from "@/server/site-url"
import { LEGACY_TENANT_ID } from "@/server/tenant/identity"
import { runAsPlatform, runWithTenant } from "@/server/tenant/context"
import { tenantHostForSlug } from "@/server/tenant/hosts"
import { listActiveTenants } from "@/server/tenant/context"
import { readFile } from "node:fs/promises"

import { podarTicketsViejos } from "@/server/tickets/ticket-imagen"

import {
  WHATSAPP_KIND_CLIENT_RENEWAL,
  WHATSAPP_KIND_PAYMENT_ORDER,
  logWhatsAppMessageDetached,
} from "./service"
import { sendWhatsAppImage, sendWhatsAppText, sessionForTenant } from "./gateway"
import { shouldDispatchTenant } from "./tenant-routing"
import type { WhatsAppSession } from "./session"

/*
 * Dispatcher de la cola de salida de WhatsApp: cada notificación de campana
 * de un usuario con WhatsApp registrado encola en `wa_outbox` (vía el hook
 * de `insertNotification`) y este despachador la entrega. Diseño:
 *
 * - Timer en proceso de 5 s con guard `ticking` (patrón de los schedulers
 *   del repo). Un solo proceso Node bajo pm2 basta.
 * - Reclamo atómico con `FOR UPDATE SKIP LOCKED` (patrón `claimDueAlerts`):
 *   sin dobles envíos aunque dos ticks se solapen o haya varios procesos.
 * - Mientras el socket no está `open` no reclama nada: los mensajes
 *   quedan `pending` y salen al reconectar (deploy, corte de red).
 * - Backoff por intento: 1 min, 5 min, 15 min, 1 h; al agotar los 5
 *   intentos la fila queda `failed` para revisión/reintento desde el
 *   módulo admin.
 * - Recuperación de choques: filas `sending` varadas > 5 min vuelven a
 *   `pending` (el proceso murió a mitad del envío).
 * - Poda de `wa_message_log` a 90 días, como máximo una vez por hora.
 */

const TICK_MS = 5_000
const BATCH = 10
const MAX_ATTEMPTS = 5
/** Minutos de gracia antes de reciclar un envío marcado `sending`. */
const STUCK_SENDING_MINUTES = 5
const BACKOFFS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
const PRUNE_EVERY_MS = 60 * 60 * 1000
const LOG_RETENTION_DAYS = 90
/** Los espejos entregados se podan más pronto: la cola activa queda ligera. */
const OUTBOX_SENT_RETENTION_DAYS = 30

export interface OutboxClaimRow {
  id: string
  phone: string
  title: string
  body: string
  kind: string | null
  attempts: number
  filePath: string | null
  fileMime: string | null
}

/** Tenant de trabajo del despacho (su socket, su contexto, su link). */
interface DispatchTenant {
  id: string
  kind: "legacy" | "business"
  slug: string
}

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false
let lastPruneAt = 0

/** Kinds DIRECTOS a destinatarios sin cuenta: sin link al panel. */
const NO_PANEL_LINK_KINDS = new Set([
  WHATSAPP_KIND_CLIENT_RENEWAL,
  WHATSAPP_KIND_PAYMENT_ORDER,
])

/**
 * Texto de WhatsApp para un envío de la cola. Los espejos de notificación
 * llevan el link al panel —del tenant emisor: el legado el sitio público, un
 * negocio SU subdominio—; los avisos DIRECTOS a destinatarios sin cuenta
 * (clientes FlujoTV `client_renewal` y pagadores de órdenes de pago
 * `payment_order`) no: un enlace que no pueden usar solo confunde.
 */
function mirrorMessage(row: OutboxClaimRow, tenant: DispatchTenant): string {
  const base = `${row.title}\n${row.body}`.trim()
  if (NO_PANEL_LINK_KINDS.has(row.kind ?? "")) return base
  const panelUrl =
    tenant.kind === "business"
      ? `https://${tenantHostForSlug(tenant.slug)}`
      : publicSiteUrl()
  return `${base}\n\nPanel: ${panelUrl}`
}

async function claimBatch(): Promise<OutboxClaimRow[]> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT id, phone, title, body, kind, attempts,
              file_path, file_mime
         FROM wa_outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [BATCH]
    )
    const rows = result.rows as Record<string, unknown>[]
    if (rows.length === 0) return []
    const ids = rows.map((row) => String(row.id))
    // El claim fija el lease (next_attempt_at = now()): la recuperación de
    // varados mide la edad del claim, no el tiempo que la fila esperó
    // pendiente — sin esto, el backlog post-deploy se reenviaría en vuelo.
    await client.query(
      `UPDATE wa_outbox
          SET status = 'sending', next_attempt_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids]
    )
    return rows.map((row) => ({
      id: String(row.id),
      phone: String(row.phone),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      kind: typeof row.kind === "string" ? row.kind : null,
      attempts: Number(row.attempts ?? 0),
      filePath: typeof row.file_path === "string" ? row.file_path : null,
      fileMime: typeof row.file_mime === "string" ? row.file_mime : null,
    }))
  })
}

/** Tope de duración de un envío en vuelo: Baileys puede quedar "open" pero
 * atascado; sin este tope el tick quedaría `ticking=true` para siempre. */
const SEND_TIMEOUT_MS = 60_000

async function sendOne(row: OutboxClaimRow, tenant: DispatchTenant): Promise<void> {
  try {
    // El envío sale por el socket del tenant propietario de la fila.
    // Filas con adjunto (ticket de compra en PNG): IMAGEN con el texto como
    // caption — el chat muestra el ticket con su branding de inmediato. Si
    // el archivo ya no está en disco (poda, limpieza), el envío degrada a
    // TEXTO en el momento — el aviso jamás se pierde.
    const texto = mirrorMessage(row, tenant)
    let send: Promise<string>
    let conImagen = false
    if (row.filePath) {
      const data = await readFile(row.filePath).catch(() => null)
      if (data) {
        conImagen = true
        send = sendWhatsAppImage(tenant.id, row.phone, {
          data,
          mimetype: row.fileMime ?? "image/png",
          caption: texto,
        })
      } else {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `whatsapp: outbox adjunto faltante ${row.id}: ${row.filePath}`,
          })
        )
        send = sendWhatsAppText(tenant.id, row.phone, texto)
      }
    } else {
      send = sendWhatsAppText(tenant.id, row.phone, texto)
    }
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("whatsapp_send_timeout")),
        SEND_TIMEOUT_MS
      )
    )
    const jid = await Promise.race([send, timeout])
    await pool.query(
      `UPDATE wa_outbox SET status = 'sent', sent_at = now(), last_error = NULL
        WHERE id = $1::uuid`,
      [row.id]
    )
    logWhatsAppMessageDetached({
      direction: "out",
      userId: null,
      phone: row.phone,
      text: `${row.title} ${row.body}`.trim(),
      meta: { source: "notification_mirror", outbox_id: row.id, jid, imagen: conImagen },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const attempts = row.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    const backoff = BACKOFFS_MS[Math.min(attempts - 1, BACKOFFS_MS.length - 1)]
    // Red de seguridad del ticket: si la IMAGEN agotó sus reintentos, el
    // pagador recibe al menos el TEXTO de confirmación — con el MISMO tope de
    // envío del resto de la cola: un socket atascado no puede congelar el
    // tick. Al entregar el texto se limpia el adjunto: el reintento manual
    // del admin ya no duplica la confirmación (texto + imagen).
    let adjuntoEntregadoComoTexto = false
    if (failed && row.filePath) {
      const textoFallback = mirrorMessage(row, tenant)
      const jidFallback = await Promise.race([
        sendWhatsAppText(tenant.id, row.phone, textoFallback),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("whatsapp_send_timeout")),
            SEND_TIMEOUT_MS
          )
        ),
      ]).catch(() => null)
      if (jidFallback) {
        adjuntoEntregadoComoTexto = true
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `whatsapp: outbox documento agotado ${row.id}: fallback texto enviado (${message})`,
          })
        )
      }
    }
    await pool.query(
      `UPDATE wa_outbox
          SET status = $2, attempts = $3,
              next_attempt_at = now() + ($4::bigint * interval '1 millisecond'),
              last_error = $5${adjuntoEntregadoComoTexto ? `,
              file_path = NULL, file_name = NULL, file_mime = NULL` : ""}
        WHERE id = $1::uuid`,
      [row.id, failed ? "failed" : "pending", attempts, backoff, message.slice(0, 400)]
    )
    if (failed) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `whatsapp: outbox dead-letter ${row.id}: ${message}`,
        })
      )
    }
  }
}

async function tick(): Promise<void> {
  // Mantenimiento (choques y poda) SIN contexto de tenant (§4.5 2A: con
  // TENANT_STRICT=on RLS le devolvía 0 filas al dispatcher sin wrapper):
  // es trabajo cross-tenant de la cola, corre como plataforma.
  await runAsPlatform(async () => {
    await pool.query(
      `UPDATE wa_outbox
          SET status = 'pending', next_attempt_at = now()
        WHERE status = 'sending'
          AND next_attempt_at < now() - ($1::int * interval '1 minute')`,
      [STUCK_SENDING_MINUTES]
    )

    if (Date.now() - lastPruneAt > PRUNE_EVERY_MS) {
      lastPruneAt = Date.now()
      await pool.query(
        `DELETE FROM wa_message_log
          WHERE created_at < now() - ($1::int * interval '1 day')`,
        [LOG_RETENTION_DAYS]
      )
      await pool.query(
        `DELETE FROM wa_outbox
          WHERE status = 'sent'
            AND sent_at < now() - ($1::int * interval '1 day')`,
        [OUTBOX_SENT_RETENTION_DAYS]
      )
      // PDFs de tickets viejos (fs puro, sin BD: sin dependencia de tenant).
      await podarTicketsViejos().catch((error: unknown) => {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `whatsapp: podar tickets: ${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        )
      })
    }
  })

  // El despacho corre POR TENANT con sesión ABIERTA (§4.5 2B): sin sesión
  // abierta no se reclama nada, así que no se queman intentos. El legado
  // entra con su sesión de boot; los negocios, la suya.
  const tenants = await listActiveTenants().catch(() => [])
  const legacy = tenants.find((t) => t.id === LEGACY_TENANT_ID)
  if (legacy) {
    await dispatchTenant({ id: legacy.id, kind: legacy.kind, slug: legacy.slug })
  }
  for (const tenant of tenants) {
    if (tenant.kind !== "business" || tenant.id === LEGACY_TENANT_ID) continue
    await dispatchTenant({ id: tenant.id, kind: tenant.kind, slug: tenant.slug })
  }
}

/** Reclama y envía UN lote del tenant si su sesión está abierta. */
async function dispatchTenant(tenant: DispatchTenant): Promise<void> {
  const session: WhatsAppSession | null = sessionForTenant(tenant.id)
  if (!shouldDispatchTenant(session?.status ?? null)) return
  // El claim y los UPDATEs de resultado corren bajo el tenant de la fila
  // (RLS por wa_outbox.tenant_id).
  await runWithTenant(tenant.id, async () => {
    const batch = await claimBatch()
    for (const row of batch) {
      await sendOne(row, tenant)
    }
  })
}

/** Arranca el dispatcher una sola vez por proceso (idempotente). */
export function startWhatsAppOutboxDispatcher(): void {
  if (timer) return
  timer = setInterval(() => {
    if (ticking) return
    ticking = true
    void tick()
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `whatsapp: outbox dispatcher: ${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        )
      })
      .finally(() => {
        ticking = false
      })
  }, TICK_MS)
  const handle = timer as unknown as { unref?: () => void }
  handle.unref?.()
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "whatsapp.outbox_dispatcher_started",
      tick_ms: TICK_MS,
    })
  )
}
