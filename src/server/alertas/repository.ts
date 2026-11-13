import { pool, withTransaction } from "@/server/db"

import {
  ALERT_STATUSES,
  isValidAlertFrequency,
  isValidTimeOfDay,
  type AlertFrequency,
  type AlertKind,
  type AlertMode,
  type AlertSpec,
  type AlertStatus,
} from "@/lib/alertas"

/**
 * Acceso a datos del módulo Alertas (`alerts`, `alert_hits`,
 * `push_subscriptions`). Toda consulta acota por `user_id`: el id de la
 * alerta nunca basta para leer o escribir de otra cuenta.
 */

/** Adjunto de referencia de una alerta (metadatos; los bytes viven en
 * `user_files` en disco). */
export interface AlertAttachmentMeta {
  fileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface AlertRow {
  id: string
  userId: string
  kind: AlertKind
  status: AlertStatus
  mode: AlertMode | null
  sourceRequest: string
  title: string
  query: string | null
  frequency: AlertFrequency | null
  timeOfDay: string | null
  weekday: number | null
  remindAt: string | null
  attachments: AlertAttachmentMeta[]
  lastFindingFingerprint: string | null
  lastCheckedAt: string | null
  lastHitAt: string | null
  checkCount: number
  errorCount: number
  lastError: string | null
  nextCheckAt: string
  createdAt: string
  updatedAt: string
}

export interface AlertHitRow {
  id: string
  alertId: string
  kind: "hit" | "reminder" | "error"
  title: string
  body: string
  sources: { title: string; url: string }[]
  fingerprint: string | null
  notified: boolean
  checkedAt: string
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return new Date(value as string).toISOString()
}

function parseAttachments(value: unknown): AlertAttachmentMeta[] {
  if (!Array.isArray(value)) return []
  const out: AlertAttachmentMeta[] = []
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue
    const raw = entry as Record<string, unknown>
    if (
      typeof raw.fileId !== "string" ||
      typeof raw.fileName !== "string" ||
      typeof raw.mimeType !== "string" ||
      typeof raw.sizeBytes !== "number"
    ) {
      continue
    }
    out.push({
      fileId: raw.fileId,
      fileName: raw.fileName,
      mimeType: raw.mimeType,
      sizeBytes: raw.sizeBytes,
    })
  }
  return out.slice(0, 4)
}

function parseSources(value: unknown): { title: string; url: string }[] {
  if (!Array.isArray(value)) return []
  const out: { title: string; url: string }[] = []
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.url !== "string") continue
    out.push({
      title: typeof raw.title === "string" ? raw.title : "",
      url: raw.url,
    })
  }
  return out
}

function mapAlertRow(row: Record<string, unknown>): AlertRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind === "reminder" ? "reminder" : "search",
    status: (ALERT_STATUSES as readonly string[]).includes(
      row.status as AlertStatus
    )
      ? (row.status as AlertStatus)
      : "active",
    mode: row.mode === "once" || row.mode === "recurring" ? row.mode : null,
    sourceRequest: String(row.source_request ?? ""),
    title: String(row.title ?? ""),
    query: row.query === null || row.query === undefined ? null : String(row.query),
    frequency: isValidAlertFrequency(row.frequency) ? row.frequency : null,
    timeOfDay: isValidTimeOfDay(row.time_of_day) ? row.time_of_day : null,
    weekday: typeof row.weekday === "number" ? row.weekday : null,
    remindAt: isoOrNull(row.remind_at),
    attachments: parseAttachments(row.attachments),
    lastFindingFingerprint:
      row.last_finding_fingerprint === null ||
      row.last_finding_fingerprint === undefined
        ? null
        : String(row.last_finding_fingerprint),
    lastCheckedAt: isoOrNull(row.last_checked_at),
    lastHitAt: isoOrNull(row.last_hit_at),
    checkCount: Number(row.check_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
    lastError:
      row.last_error === null || row.last_error === undefined
        ? null
        : String(row.last_error),
    nextCheckAt: new Date(row.next_check_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  }
}

function mapHitRow(row: Record<string, unknown>): AlertHitRow {
  return {
    id: String(row.id),
    alertId: String(row.alert_id),
    kind:
      row.kind === "reminder" || row.kind === "error"
        ? (row.kind as AlertHitRow["kind"])
        : "hit",
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    sources: parseSources(row.sources),
    fingerprint:
      row.fingerprint === null || row.fingerprint === undefined
        ? null
        : String(row.fingerprint),
    notified: row.notified === true,
    checkedAt: new Date(row.checked_at as string).toISOString(),
  }
}

const ALERT_COLUMNS = `id, user_id, kind, status, mode, source_request, title,
  query, frequency, time_of_day, weekday, remind_at, attachments,
  last_finding_fingerprint, last_checked_at, last_hit_at, check_count,
  error_count, last_error, next_check_at, created_at, updated_at`

export interface InsertAlertInput {
  userId: string
  spec: AlertSpec
  sourceRequest: string
  attachments: AlertAttachmentMeta[]
  /** Próxima revisión en UTC (remind_at para recordatorios). */
  nextCheckAt: Date
}

/**
 * Inserta la alerta respetando el tope de alertas activas por usuario,
 * dentro de una transacción con advisory lock por usuario (patrón
 * `createCouponOrder`): count + insert atómicos, sin carrera TOCTOU entre
 * creaciones concurrentes. Devuelve null cuando el usuario ya llegó al tope.
 */
export async function insertAlertCapped(
  input: InsertAlertInput,
  maxActive: number
): Promise<AlertRow | null> {
  const { spec } = input
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      input.userId,
    ])
    const count = await client.query(
      `SELECT count(*)::int AS count
         FROM alerts
        WHERE user_id = $1::uuid AND status = 'active'`,
      [input.userId]
    )
    if (Number(count.rows[0]?.count ?? 0) >= maxActive) return null

    const result = await client.query(
      `INSERT INTO alerts
         (id, user_id, kind, status, mode, source_request, title, query,
          frequency, time_of_day, weekday, remind_at, attachments, next_check_at)
       VALUES ($1::uuid, $2::uuid, $3, 'active', $4, $5, $6, $7,
               $8, $9, $10, $11, $12::jsonb, $13)
       RETURNING ${ALERT_COLUMNS}`,
      [
        crypto.randomUUID(),
        input.userId,
        spec.kind,
        spec.mode,
        input.sourceRequest,
        spec.title,
        spec.query,
        spec.frequency,
        spec.timeOfDay,
        spec.weekday,
        spec.remindAt ? new Date(spec.remindAt) : null,
        JSON.stringify(input.attachments),
        input.nextCheckAt,
      ]
    )
    return mapAlertRow(result.rows[0])
  })
}

/**
 * Último hit por alerta del usuario, para el resumen del listado. El join
 * lateral es un top-1 por alerta que usa el índice (alert_id, checked_at
 * DESC): un DISTINCT ON sobre todo el historial del usuario ordenaría cada
 * vez más filas a medida que crece `alert_hits`.
 */
export async function latestHitByAlert(
  userId: string
): Promise<Map<string, AlertHitRow>> {
  const result = await pool.query(
    `SELECT h.id, h.alert_id, h.kind, h.title, h.body, h.sources,
            h.fingerprint, h.notified, h.checked_at
       FROM alerts a
       LEFT JOIN LATERAL (
         SELECT id, alert_id, kind, title, body, sources, fingerprint,
                notified, checked_at
           FROM alert_hits hit
          WHERE hit.alert_id = a.id
          ORDER BY hit.checked_at DESC
          LIMIT 1
       ) h ON true
      WHERE a.user_id = $1::uuid AND h.id IS NOT NULL`,
    [userId]
  )
  const map = new Map<string, AlertHitRow>()
  for (const row of result.rows) {
    const hit = mapHitRow(row)
    map.set(hit.alertId, hit)
  }
  return map
}

/** Retención del historial: deja solo los últimos `keepPerAlert` hits por alerta. */
export async function pruneAlertHits(keepPerAlert: number): Promise<void> {
  await pool.query(
    `DELETE FROM alert_hits h
      USING (
        SELECT id, row_number() OVER (PARTITION BY alert_id ORDER BY checked_at DESC) AS rn
          FROM alert_hits
      ) ranked
     WHERE h.id = ranked.id AND ranked.rn > $1`,
    [keepPerAlert]
  )
}

export async function listAlerts(userId: string): Promise<AlertRow[]> {
  const result = await pool.query(
    `SELECT ${ALERT_COLUMNS}
       FROM alerts
      WHERE user_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 200`,
    [userId]
  )
  return result.rows.map(mapAlertRow)
}

export async function getAlert(
  userId: string,
  alertId: string
): Promise<AlertRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(alertId)) return null
  const result = await pool.query(
    `SELECT ${ALERT_COLUMNS}
       FROM alerts
      WHERE id = $1::uuid AND user_id = $2::uuid`,
    [alertId, userId]
  )
  return result.rows[0] ? mapAlertRow(result.rows[0]) : null
}

/** Lectura interna del scheduler (corre en el servidor, sin sesión). */
export async function getAlertById(alertId: string): Promise<AlertRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(alertId)) return null
  const result = await pool.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts WHERE id = $1::uuid`,
    [alertId]
  )
  return result.rows[0] ? mapAlertRow(result.rows[0]) : null
}

const HIT_LIMIT = 50

export async function listHits(
  userId: string,
  alertId: string,
  limit: number = HIT_LIMIT
): Promise<AlertHitRow[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), HIT_LIMIT)
  const result = await pool.query(
    `SELECT id, alert_id, kind, title, body, sources, fingerprint,
            notified, checked_at
       FROM alert_hits
      WHERE alert_id = $1::uuid AND user_id = $2::uuid
      ORDER BY checked_at DESC
      LIMIT $3`,
    [alertId, userId, capped]
  )
  return result.rows.map(mapHitRow)
}

export interface AlertPatch {
  status?: "active" | "paused"
  frequency?: AlertFrequency
  timeOfDay?: string | null
  weekday?: number | null
  mode?: AlertMode
  remindAt?: Date
  /** Próxima revisión recalculada (obligatoria al tocar schedule o status). */
  nextCheckAt?: Date
  errorCount?: number
  lastError?: string | null
}

export async function updateAlert(
  userId: string,
  alertId: string,
  patch: AlertPatch
): Promise<AlertRow | null> {
  const values: unknown[] = []
  const sets: string[] = []
  const push = (fragment: string, value: unknown) => {
    values.push(value)
    sets.push(`${fragment} = $${values.length}`)
  }

  if (patch.status) push("status", patch.status)
  if (patch.frequency !== undefined) push("frequency", patch.frequency)
  if (patch.timeOfDay !== undefined) push("time_of_day", patch.timeOfDay)
  if (patch.weekday !== undefined) push("weekday", patch.weekday)
  if (patch.mode !== undefined) push("mode", patch.mode)
  if (patch.remindAt !== undefined) push("remind_at", patch.remindAt)
  if (patch.nextCheckAt) push("next_check_at", patch.nextCheckAt)
  if (patch.errorCount !== undefined) push("error_count", patch.errorCount)
  if (patch.lastError !== undefined) push("last_error", patch.lastError)
  if (sets.length === 0) return getAlert(userId, alertId)

  values.push(userId, alertId)
  const result = await pool.query(
    `UPDATE alerts
        SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $${values.length - 1}::uuid AND user_id = $${values.length}::uuid
      RETURNING ${ALERT_COLUMNS}`,
    values
  )
  return result.rows[0] ? mapAlertRow(result.rows[0]) : null
}

export async function deleteAlert(userId: string, alertId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM alerts WHERE id = $1::uuid AND user_id = $2::uuid`,
    [alertId, userId]
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Reclama las alertas vencidas: dentro de una transacción toma los ids con
 * `FOR UPDATE SKIP LOCKED` y adelanta su `next_check_at` un minuto, de modo
 * que otra pasada (o otro proceso) no los recoja mientras vuelan. El
 * schedule definitivo lo fija el procesamiento al terminar; si el proceso
 * muere a mitad, el siguiente tick las retoma en un minuto. El filtro por
 * `kind` separa el carril rápido de recordatorios del carril de búsquedas
 * (checks de LLM que tardan decenas de segundos).
 */
export async function claimDueAlerts(
  limit: number,
  kind?: AlertKind
): Promise<string[]> {
  return withTransaction(async (client) => {
    const values: unknown[] = [limit]
    let where = `status = 'active' AND next_check_at <= now()`
    if (kind) {
      values.push(kind)
      where += ` AND kind = $${values.length}`
    }
    const due = await client.query(
      `SELECT id FROM alerts
        WHERE ${where}
        ORDER BY next_check_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      values
    )
    const ids = due.rows.map((row) => String(row.id))
    if (ids.length > 0) {
      await client.query(
        `UPDATE alerts
            SET next_check_at = now() + interval '1 minute', updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [ids]
      )
    }
    return ids
  })
}

export interface HitRecordInput {
  alertId: string
  userId: string
  kind: "hit" | "reminder" | "error"
  title: string
  body: string
  sources: { title: string; url: string }[]
  fingerprint?: string | null
  notified: boolean
  /** true cuando el hit debe reflejarse como último hallazgo (last_hit_at). */
  countsAsHit: boolean
  nextCheckAt: Date
  status?: AlertStatus
  errorCount?: number
  lastError?: string | null
  lastFindingFingerprint?: string | null
}

/** Registra el hit y aplica la actualización de la alerta en una transacción. */
export async function recordHit(input: HitRecordInput): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO alert_hits
         (id, alert_id, user_id, kind, title, body, sources, fingerprint,
          notified, checked_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9, now())`,
      [
        crypto.randomUUID(),
        input.alertId,
        input.userId,
        input.kind,
        input.title,
        input.body,
        JSON.stringify(input.sources),
        input.fingerprint ?? null,
        input.notified,
      ]
    )
    const sets: string[] = ["updated_at = now()", "last_checked_at = now()"]
    const values: unknown[] = []
    const push = (fragment: string, value: unknown) => {
      values.push(value)
      sets.push(`${fragment} = $${values.length}`)
    }
    push("next_check_at", input.nextCheckAt)
    if (input.status) push("status", input.status)
    if (input.errorCount !== undefined) push("error_count", input.errorCount)
    if (input.lastError !== undefined) push("last_error", input.lastError)
    if (input.countsAsHit) push("last_hit_at", new Date())
    if (input.lastFindingFingerprint !== undefined) {
      push("last_finding_fingerprint", input.lastFindingFingerprint)
    }
    if (input.kind === "hit" || input.kind === "reminder") {
      sets.push("check_count = check_count + 1")
    }
    values.push(input.alertId)
    await client.query(
      `UPDATE alerts SET ${sets.join(", ")} WHERE id = $${values.length}::uuid`,
      values
    )
  })
}

/** Marca una revisión fallida (sin hit): cuenta el error y reprograma. */
export async function recordCheckError(
  alertId: string,
  errorCount: number,
  lastError: string,
  nextCheckAt: Date,
  status?: AlertStatus
): Promise<void> {
  await pool.query(
    `UPDATE alerts
        SET check_count = check_count + 1,
            error_count = $2,
            last_error = $3,
            next_check_at = $4,
            status = COALESCE($5, status),
            last_checked_at = now(),
            updated_at = now()
      WHERE id = $1::uuid`,
    [alertId, errorCount, lastError.slice(0, 400), nextCheckAt, status ?? null]
  )
}

/** Revisión sin hallazgo: resetea el conteo de errores y reprograma. */
export async function markCheckOnly(
  alertId: string,
  nextCheckAt: Date
): Promise<void> {
  await pool.query(
    `UPDATE alerts
        SET check_count = check_count + 1,
            error_count = 0,
            last_error = NULL,
            last_checked_at = now(),
            next_check_at = $2,
            updated_at = now()
      WHERE id = $1::uuid`,
    [alertId, nextCheckAt]
  )
}

/*
 * ── Suscripciones Web Push ──────────────────────────────────────────────
 */

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export async function upsertPushSubscription(input: {
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
}): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO push_subscriptions
       (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
        SET p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            created_at = now()
      WHERE push_subscriptions.user_id = EXCLUDED.user_id`,
    [
      crypto.randomUUID(),
      input.userId,
      input.endpoint,
      input.p256dh,
      input.auth,
      input.userAgent,
    ]
  )
  // Un conflicto con otra cuenta no actualiza nada: el endpoint pertenece al
  // dispositivo de quien lo registró primero y solo cambia de dueño con una
  // re-suscripción genuina de ese navegador (mismas llaves).
  return (result.rowCount ?? 0) > 0
}

export async function deletePushSubscription(
  userId: string,
  endpoint: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM push_subscriptions WHERE user_id = $1::uuid AND endpoint = $2`,
    [userId, endpoint]
  )
  return (result.rowCount ?? 0) > 0
}

export async function listPushSubscriptions(
  userId: string
): Promise<PushSubscriptionRow[]> {
  const result = await pool.query(
    `SELECT id, endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id = $1::uuid`,
    [userId]
  )
  return result.rows.map((row) => ({
    id: String(row.id),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
  }))
}

export async function deletePushSubscriptionByEndpoint(
  endpoint: string
): Promise<void> {
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [
    endpoint,
  ])
}

export async function touchPushSubscription(id: string): Promise<void> {
  await pool.query(
    `UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1::uuid`,
    [id]
  )
}
