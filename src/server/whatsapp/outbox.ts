import { pool, withTransaction } from "@/server/db"
import { publicSiteUrl } from "@/server/site-url"

import { logWhatsAppMessageDetached } from "./service"
import { getWhatsAppStatus, sendWhatsAppText } from "./socket"

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
  attempts: number
}

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false
let lastPruneAt = 0

/** Texto de WhatsApp para un espejo de notificación (título + cuerpo + link). */
function mirrorMessage(row: OutboxClaimRow): string {
  return `${row.title}\n${row.body}\n\nPanel: ${publicSiteUrl()}`
}

async function claimBatch(): Promise<OutboxClaimRow[]> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT id, phone, title, body, attempts
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
      attempts: Number(row.attempts ?? 0),
    }))
  })
}

/** Tope de duración de un envío en vuelo: Baileys puede quedar "open" pero
 * atascado; sin este tope el tick quedaría `ticking=true` para siempre. */
const SEND_TIMEOUT_MS = 60_000

async function sendOne(row: OutboxClaimRow): Promise<void> {
  try {
    const send = sendWhatsAppText(row.phone, mirrorMessage(row))
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
      meta: { source: "notification_mirror", outbox_id: row.id, jid },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const attempts = row.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    const backoff = BACKOFFS_MS[Math.min(attempts - 1, BACKOFFS_MS.length - 1)]
    await pool.query(
      `UPDATE wa_outbox
          SET status = $2, attempts = $3,
              next_attempt_at = now() + ($4::bigint * interval '1 millisecond'),
              last_error = $5
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
  // Choques y poda no dependen del socket: corren aunque esté desconectado
  // (una revocación larga no debe dejar la bitácora sin poda ni el estado
  // `sending` sin recuperación).
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
  }

  if (getWhatsAppStatus().status !== "open") return

  const batch = await claimBatch()
  for (const row of batch) {
    await sendOne(row)
  }
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
