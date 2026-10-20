import { pool } from "@/server/db"
import { fixRates, mxDayKey, type FixRateInfo } from "@/server/banxico"
import { createSystemAnimationExpense } from "@/server/finanzas/gastos"
import { deleteUserFile } from "@/server/storage/user-files"

export interface AnimationDeliverablePayload {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
  sessionId: string
  turnId: string | null
  costUsd: number | null
  costMxn: number | null
  timeMs: number | null
  createdAt: string
}

interface DeliverableRow {
  id: string
  file_id: string
  session_id: string
  turn_id: string | null
  created_at: Date
  deliverable_name: string
  deliverable_mime: string
  deliverable_bytes: string | number
  stored_name: string | null
  stored_mime: string | null
  stored_bytes: string | number | null
  session_cost_usd: string | null
  session_time_ms: string | null
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapDeliverableRow(
  row: DeliverableRow,
  rate: number | null
): AnimationDeliverablePayload {
  const costUsd = toNumber(row.session_cost_usd)
  return {
    id: row.id,
    fileName: row.stored_name ?? row.deliverable_name,
    mimeType: row.stored_mime ?? row.deliverable_mime,
    sizeBytes: Number(row.stored_bytes ?? row.deliverable_bytes ?? 0),
    url: `/api/files/${row.file_id}`,
    sessionId: row.session_id,
    turnId: row.turn_id,
    costUsd,
    costMxn: costUsd === null || rate === null ? null : round6(costUsd * rate),
    timeMs: toNumber(row.session_time_ms),
    createdAt: row.created_at.toISOString(),
  }
}

const SELECT_DELIVERABLE = `
  SELECT d.id, d.file_id, d.session_id, d.turn_id, d.created_at,
         d.file_name AS deliverable_name,
         d.mime_type AS deliverable_mime,
         d.size_bytes AS deliverable_bytes,
         f.file_name AS stored_name,
         f.mime_type AS stored_mime,
         f.size_bytes AS stored_bytes,
         (SELECT sum(c.cost_usd)
            FROM animation_costs c
           WHERE c.session_id = d.session_id AND c.cost_usd IS NOT NULL) AS session_cost_usd,
         (SELECT sum(t.duration_ms)
            FROM animation_turns t
           WHERE t.session_id = d.session_id AND t.duration_ms IS NOT NULL) AS session_time_ms
    FROM animation_deliverables d
    LEFT JOIN user_files f ON f.id = d.file_id`

export interface AnimationLifetimeCost {
  totalUsd: number
  /** null when the Banxico rate is unavailable for at least one costed day */
  totalMxn: number | null
  rates: Map<string, number | null>
  latest: FixRateInfo | null
}

/** Lifetime agent spend: costs persist even when a deliverable is deleted. */
async function lifetimeCost(userId: string): Promise<AnimationLifetimeCost> {
  const result = await pool.query(
    `SELECT (created_at AT TIME ZONE 'America/Mexico_City')::date::text AS day,
            SUM(cost_usd)::float8 AS cost
       FROM animation_costs
      WHERE user_id = $1 AND cost_usd IS NOT NULL
      GROUP BY 1`,
    [userId]
  )
  const usdByDay = new Map<string, number>()
  let totalUsd = 0
  for (const row of result.rows as { day: string; cost: number }[]) {
    totalUsd += row.cost
    usdByDay.set(row.day, row.cost)
  }
  totalUsd = round6(totalUsd)
  // Today is always requested: the caller may be about to bill a new turn on
  // a day that has no stored rows yet.
  const requestedDays = [...usdByDay.keys(), mxDayKey(new Date())]
  const { rates, latest } = await fixRates(requestedDays)
  if (usdByDay.size === 0) {
    return { totalUsd: 0, totalMxn: 0, rates, latest }
  }
  let totalMxn = 0
  for (const [day, cost] of usdByDay) {
    const rate = rates.get(day)
    if (rate === undefined || rate === null) {
      return { totalUsd, totalMxn: null, rates, latest }
    }
    totalMxn += cost * rate
  }
  return { totalUsd, totalMxn: round6(totalMxn), rates, latest }
}

export async function listAnimationDeliverables(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{
  animations: AnimationDeliverablePayload[]
  total: number
  totalCostUsd: number
  totalCostMxn: number | null
  totalTimeMs: number
  fx: FixRateInfo | null
}> {
  const totalResult = await pool.query(
    `SELECT count(*)::int AS count
       FROM animation_deliverables
      WHERE user_id = $1 AND deleted_at IS NULL AND file_id IS NOT NULL`,
    [userId]
  )
  const timeResult = await pool.query(
    `SELECT COALESCE(SUM(duration_ms), 0)::float8 AS total_time
       FROM animation_turns
      WHERE user_id = $1`,
    [userId]
  )
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200)
  const offset = Math.max(options.offset ?? 0, 0)
  const result = await pool.query(
    `${SELECT_DELIVERABLE}
      WHERE d.user_id = $1 AND d.deleted_at IS NULL AND d.file_id IS NOT NULL
      ORDER BY d.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  )
  const lifetime = await lifetimeCost(userId)
  return {
    animations: result.rows.map((row) =>
      mapDeliverableRow(
        row as DeliverableRow,
        lifetime.rates.get(mxDayKey((row as DeliverableRow).created_at)) ?? null
      )
    ),
    total: Number(totalResult.rows[0].count),
    totalCostUsd: lifetime.totalUsd,
    totalCostMxn: lifetime.totalMxn,
    totalTimeMs: toNumber(timeResult.rows[0]?.total_time) ?? 0,
    fx: lifetime.latest,
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/*
 * Soft delete: the deliverable leaves the gallery and its binary is removed,
 * but metered spend and working time stay so totals keep matching reality.
 */
export async function deleteAnimationDeliverable(
  userId: string,
  deliverableId: string
): Promise<boolean> {
  if (!UUID_RE.test(deliverableId)) return false
  // Read file_id before nulling it: UPDATE ... RETURNING yields the new value.
  const found = await pool.query(
    `SELECT file_id FROM animation_deliverables
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [deliverableId, userId]
  )
  if (!found.rowCount) return false
  const fileId = found.rows[0].file_id as string | null
  await pool.query(
    `UPDATE animation_deliverables
        SET deleted_at = now(), file_id = NULL
      WHERE id = $1`,
    [deliverableId]
  )
  if (fileId) await deleteUserFile(userId, fileId).catch(() => {})
  return true
}

/*
 * Metering. All functions are best-effort callers: the agent hook logs and
 * moves on, so a meter failure never breaks a turn or a delivery.
 */

export interface MeterAnimationStepInput {
  userId: string
  sessionId: string
  turnId: string
  stepIndex: number
  model: string
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
}

export async function meterAnimationStep(
  input: MeterAnimationStepInput
): Promise<void> {
  await pool.query(
    `INSERT INTO animation_costs
       (id, user_id, session_id, turn_id, step_index, model,
        cost_usd, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id, turn_id, step_index) DO UPDATE
       SET model = EXCLUDED.model,
           cost_usd = EXCLUDED.cost_usd,
           input_tokens = EXCLUDED.input_tokens,
           output_tokens = EXCLUDED.output_tokens`,
    [
      crypto.randomUUID(),
      input.userId,
      input.sessionId,
      input.turnId,
      input.stepIndex,
      input.model,
      input.costUsd === null ? null : input.costUsd.toFixed(6),
      input.inputTokens,
      input.outputTokens,
    ]
  )
}

export async function openAnimationTurn(input: {
  userId: string
  sessionId: string
  turnId: string
  startedAt: Date
}): Promise<void> {
  await pool.query(
    `INSERT INTO animation_turns (id, user_id, session_id, turn_id, started_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, turn_id) DO NOTHING`,
    [crypto.randomUUID(), input.userId, input.sessionId, input.turnId, input.startedAt]
  )
}

export async function addTurnInputWait(
  sessionId: string,
  turnId: string,
  waitMs: number
): Promise<void> {
  const ms = Math.max(0, Math.round(waitMs))
  if (ms === 0) return
  await pool.query(
    `UPDATE animation_turns
        SET wait_input_ms = wait_input_ms + $3
      WHERE session_id = $1 AND turn_id = $2`,
    [sessionId, turnId, ms]
  )
}

export async function closeAnimationTurn(
  sessionId: string,
  turnId: string,
  endedAt: Date
): Promise<void> {
  await pool.query(
    `UPDATE animation_turns
        SET ended_at = $3,
            duration_ms = GREATEST(
              0,
              (EXTRACT(EPOCH FROM ($3::timestamptz - started_at)) * 1000)::bigint
                - wait_input_ms
            )
      WHERE session_id = $1 AND turn_id = $2 AND ended_at IS NULL`,
    [sessionId, turnId, endedAt]
  )
}

export async function getTurnCostUsd(
  sessionId: string,
  turnId: string
): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost
       FROM animation_costs
      WHERE session_id = $1 AND turn_id = $2`,
    [sessionId, turnId]
  )
  const cost = toNumber(result.rows[0]?.cost) ?? 0
  return round6(cost)
}

/*
 * Mirrors one metered turn into the user's expense control (category
 * "Animación"). Best effort by design: a failure here must never fail the
 * turn, and the unique (session, turn) index makes repeated calls idempotent.
 */
export async function mirrorAnimationTurnExpense(params: {
  userId: string
  sessionId: string
  turnId: string
  model: string | null
  costUsd: number
}): Promise<void> {
  if (!(params.costUsd > 0)) return
  try {
    const day = mxDayKey(new Date())
    const { rates, latest } = await fixRates([day])
    const rate = rates.get(day) ?? latest?.rate ?? null
    await createSystemAnimationExpense({
      userId: params.userId,
      sourceSessionId: params.sessionId,
      sourceTurnId: params.turnId,
      description: `Animación IA — turno ${params.turnId} de la conversación`,
      notes: params.model ? `Modelo: ${params.model}` : null,
      amount: params.costUsd,
      spentOn: day,
      exchangeRate: rate,
      mxnEquivalent:
        rate !== null ? Math.round(params.costUsd * rate * 1e6) / 1e6 : null,
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `animaciones: expense mirror failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }
}
