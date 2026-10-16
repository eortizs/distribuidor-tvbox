import {
  withTransaction,
  type PoolClientLike,
} from "@/server/db"
import {
  AppError,
  ENTITY_STATES,
  STATUS_LOG_MAX,
  type EntityEventRow,
  type EntityRow,
  type UmeJson,
  type UmeStatusLogEntry,
} from "./types"

export interface CreateEntityOptions {
  actor?: string
  reason?: string
  source?: string
  occurredAt?: string
  provenance?: { fileHash?: string; rowIdx?: number }
}

export interface MutationOptions {
  actor?: string
  reason?: string
  occurredAt?: string
  ownedByDistribuidorId?: string
}

const FORBIDDEN_PROPERTY_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
])

export interface OwnershipScope {
  ownedByDistribuidorId?: string
}

export interface ListEntitiesParams {
  entityName?: string
  q?: string
  distribuidorId?: string
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface ListEntitiesResult {
  items: EntityRow[]
  total: number
}

function normalizeActor(actor?: string): string {
  const trimmed = actor?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : "system"
}

function toIso(value: Date | string | undefined | null): string {
  if (!value) return new Date().toISOString()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapEntityRow(row: Record<string, unknown>): EntityRow {
  return {
    id: row.id as string,
    entityName: row.entity_name as string,
    doc: row.doc as UmeJson,
    version: row.version as number,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    deletedAt: (row.deleted_at as Date | null) ?? null,
  }
}

function mapEventRow(row: Record<string, unknown>): EntityEventRow {
  return {
    entityId: row.entity_id as string,
    seq: row.seq as number,
    eventType: row.event_type as string,
    payload: row.payload as Record<string, unknown>,
    actor: row.actor as string,
    reason: (row.reason as string | null) ?? null,
    occurredAt: row.occurred_at as Date,
    recordedAt: row.recorded_at as Date,
  }
}

async function nextSeq(
  client: PoolClientLike,
  entityId: string
): Promise<number> {
  const result = await client.query(
    "SELECT coalesce(max(seq), 0) + 1 AS seq FROM entity_events WHERE entity_id = $1",
    [entityId]
  )
  return result.rows[0].seq as number
}

async function insertEvent(
  client: PoolClientLike,
  params: {
    entityId: string
    seq: number
    eventType: string
    payload: Record<string, unknown>
    actor: string
    reason?: string | null
    occurredAt: string
  }
): Promise<void> {
  await client.query(
    `INSERT INTO entity_events
       (entity_id, seq, event_type, payload, actor, reason, occurred_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)`,
    [
      params.entityId,
      params.seq,
      params.eventType,
      JSON.stringify(params.payload),
      params.actor,
      params.reason ?? null,
      params.occurredAt,
    ]
  )
}

async function loadEntityDoc(
  client: PoolClientLike,
  id: string,
  scope?: OwnershipScope
): Promise<{ doc: UmeJson; version: number }> {
  const result = await client.query(
    "SELECT doc, version FROM entities WHERE id = $1 AND deleted_at IS NULL",
    [id]
  )
  if (result.rowCount === 0) {
    throw new AppError(404, "not_found", `Entity ${id} does not exist`)
  }
  const doc = result.rows[0].doc as UmeJson
  assertOwnership(doc, scope)
  return { doc, version: result.rows[0].version as number }
}

function assertOwnership(
  doc: UmeJson,
  scope?: OwnershipScope
): void {
  if (!scope?.ownedByDistribuidorId) return
  const ownerId = doc.dynamicProperties?.distribuidorId
  if (ownerId !== scope.ownedByDistribuidorId) {
    throw new AppError(404, "not_found", `Entity does not exist`)
  }
}

async function updateHeadWithOptimisticLock(
  client: PoolClientLike,
  params: {
    id: string
    expectedVersion: number
    doc: UmeJson
  }
): Promise<number> {
  const result = await client.query(
    `UPDATE entities
       SET doc = $2::jsonb, version = version + 1, updated_at = now()
     WHERE id = $1 AND version = $3 AND deleted_at IS NULL`,
    [params.id, JSON.stringify(params.doc), params.expectedVersion]
  )
  if (result.rowCount === 0) {
    throw new AppError(
      409,
      "version_conflict",
      `Version conflict for entity ${params.id}: expected ${params.expectedVersion}`
    )
  }
  return params.expectedVersion + 1
}

async function projectStatusLog(
  client: PoolClientLike,
  entityId: string
): Promise<UmeStatusLogEntry[]> {
  const result = await client.query(
    `SELECT payload->>'to' AS status, reason, occurred_at AS timestamp
       FROM entity_events
      WHERE entity_id = $1 AND event_type = 'state.changed'
      UNION ALL
      SELECT payload->>'state' AS status, reason, occurred_at AS timestamp
        FROM entity_events
       WHERE entity_id = $1 AND event_type = 'created'`,
    [entityId]
  )
  const entries = result.rows
    .map((row) => ({
      status: row.status as string,
      reason: (row.reason as string | null) ?? undefined,
      timestamp: toIso(row.timestamp as Date),
    }))
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, STATUS_LOG_MAX)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  return entries
}

export async function createEntity(
  doc: UmeJson,
  options: CreateEntityOptions = {},
  client?: PoolClientLike
): Promise<EntityRow> {
  const actor = normalizeActor(options.actor)
  const createdAt = toIso(doc.lifecycle.createdAt)
  const occurredAt = toIso(
    options.occurredAt ?? doc.state?.statusLog?.[0]?.timestamp ?? createdAt
  )
  const initialState = doc.state?.current ?? "active"

  const run = async (tx: PoolClientLike): Promise<EntityRow> => {
    await tx.query(
      `INSERT INTO entities (id, entity_name, doc, version, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz, $6::timestamptz)`,
      [
        doc.id,
        doc.entityName,
        JSON.stringify(doc),
        doc.lifecycle.version ?? 1,
        createdAt,
        createdAt,
      ]
    )

    let seq = await nextSeq(tx, doc.id)

    if (options.provenance?.fileHash || options.provenance?.rowIdx != null) {
      await insertEvent(tx, {
        entityId: doc.id,
        seq,
        eventType: "imported.from",
        payload: {
          ...(options.provenance.fileHash
            ? { file_hash: options.provenance.fileHash }
            : {}),
          ...(options.provenance.rowIdx != null
            ? { row_idx: options.provenance.rowIdx }
            : {}),
        },
        actor,
        reason: options.reason ?? null,
        occurredAt,
      })
      seq += 1
    }

    await insertEvent(tx, {
      entityId: doc.id,
      seq,
      eventType: "created",
      payload: {
        entityName: doc.entityName,
        state: initialState,
        source: options.source ?? "ui",
      },
      actor,
      reason: options.reason ?? null,
      occurredAt,
    })

    const inserted = await tx.query("SELECT * FROM entities WHERE id = $1", [
      doc.id,
    ])
    return mapEntityRow(inserted.rows[0])
  }

  return client ? run(client) : withTransaction(run)
}

export async function getEntity(
  id: string,
  scope?: OwnershipScope
): Promise<EntityRow> {
  const result = await withTransaction(async (client) => {
    return client.query(
      "SELECT * FROM entities WHERE id = $1 AND deleted_at IS NULL",
      [id]
    )
  })
  if (result.rowCount === 0) {
    throw new AppError(404, "not_found", `Entity ${id} does not exist`)
  }
  const row = mapEntityRow(result.rows[0])
  assertOwnership(row.doc, scope)
  return row
}

export async function listEntities(
  params: ListEntitiesParams = {}
): Promise<ListEntitiesResult> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)

  const conditions: string[] = []
  const values: unknown[] = []

  if (!params.includeDeleted) {
    conditions.push("deleted_at IS NULL")
  }
  if (params.entityName) {
    values.push(params.entityName)
    conditions.push(`entity_name = $${values.length}`)
  }
  if (params.q) {
    const escaped = params.q.replace(/[\\%_]/g, (match) => `\\${match}`)
    values.push(`%${escaped}%`)
    conditions.push(`doc::text ILIKE $${values.length}`)
  }
  if (params.distribuidorId) {
    values.push(
      JSON.stringify({
        dynamicProperties: { distribuidorId: params.distribuidorId },
      })
    )
    conditions.push(`doc @> $${values.length}::jsonb`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  const result = await withTransaction(async (client) => {
    return client.query(
      `SELECT *, count(*) OVER () AS total_count
         FROM entities
         ${whereClause}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values
    )
  })

  const total =
    result.rows.length > 0 ? Number(result.rows[0].total_count) : 0

  return {
    items: result.rows.map(mapEntityRow),
    total,
  }
}

export async function updateProperties(
  id: string,
  expectedVersion: number,
  properties: Record<string, unknown>,
  options: MutationOptions = {}
): Promise<EntityRow> {
  if (
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties) ||
    Object.keys(properties).length === 0
  ) {
    throw new AppError(
      422,
      "validation_error",
      "dynamicProperties must be a non-empty object"
    )
  }

  for (const key of Object.keys(properties)) {
    if (FORBIDDEN_PROPERTY_KEYS.has(key)) {
      throw new AppError(
        422,
        "forbidden_property_key",
        `Property key '${key}' is not allowed`
      )
    }
  }

  const actor = normalizeActor(options.actor)
  const occurredAt = toIso(options.occurredAt)

  return withTransaction(async (client) => {
    const current = await loadEntityDoc(client, id, {
      ownedByDistribuidorId: options.ownedByDistribuidorId,
    })

    const diff: Record<
      string,
      { from: unknown; to: unknown }
    > = {}
    for (const [key, to] of Object.entries(properties)) {
      const from = key in current.doc.dynamicProperties
        ? current.doc.dynamicProperties[key]
        : null
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        diff[key] = { from, to }
      }
    }
    if (Object.keys(diff).length === 0) {
      throw new AppError(
        422,
        "no_changes",
        "No property values changed"
      )
    }

    const newDoc = structuredClone(current.doc)
    for (const [key, value] of Object.entries(properties)) {
      newDoc.dynamicProperties[key] = value
    }
    newDoc.lifecycle.version = current.version + 1
    newDoc.lifecycle.updatedAt = occurredAt

    await updateHeadWithOptimisticLock(client, {
      id,
      expectedVersion,
      doc: newDoc,
    })

    await insertEvent(client, {
      entityId: id,
      seq: await nextSeq(client, id),
      eventType: "property.updated",
      payload: { diff },
      actor,
      reason: options.reason ?? null,
      occurredAt,
    })

    return getEntityInsideTransaction(client, id)
  })
}

export async function changeState(
  id: string,
  expectedVersion: number,
  toState: string,
  options: MutationOptions = {}
): Promise<EntityRow> {
  if (
    !ENTITY_STATES.includes(toState as (typeof ENTITY_STATES)[number])
  ) {
    throw new AppError(
      422,
      "validation_error",
      `Invalid state '${toState}'. Allowed states: ${ENTITY_STATES.join(", ")}`
    )
  }

  const actor = normalizeActor(options.actor)
  const occurredAt = toIso(options.occurredAt)

  return withTransaction(async (client) => {
    const current = await loadEntityDoc(client, id, {
      ownedByDistribuidorId: options.ownedByDistribuidorId,
    })
    const fromState = current.doc.state.current

    if (fromState === toState) {
      throw new AppError(
        422,
        "same_state",
        `Entity is already in state '${toState}'`
      )
    }

    const newDoc = structuredClone(current.doc)
    newDoc.state.current = toState
    newDoc.state.statusLog = [
      ...(newDoc.state.statusLog ?? []),
      { status: toState, timestamp: occurredAt, reason: options.reason },
    ].slice(-STATUS_LOG_MAX)
    newDoc.lifecycle.version = current.version + 1
    newDoc.lifecycle.updatedAt = occurredAt

    await updateHeadWithOptimisticLock(client, {
      id,
      expectedVersion,
      doc: newDoc,
    })

    await insertEvent(client, {
      entityId: id,
      seq: await nextSeq(client, id),
      eventType: "state.changed",
      payload: { from: fromState, to: toState },
      actor,
      reason: options.reason ?? null,
      occurredAt,
    })

    const projected = await projectStatusLog(client, id)
    await client.query(
      `UPDATE entities
          SET doc = jsonb_set(doc, '{state,statusLog}', $2::jsonb)
        WHERE id = $1`,
      [id, JSON.stringify(projected)]
    )

    return getEntityInsideTransaction(client, id)
  })
}

async function getEntityInsideTransaction(
  client: PoolClientLike,
  id: string
): Promise<EntityRow> {
  const result = await client.query(
    "SELECT * FROM entities WHERE id = $1",
    [id]
  )
  return mapEntityRow(result.rows[0])
}

export async function getEntityEvents(
  id: string,
  scope?: OwnershipScope
): Promise<EntityEventRow[]> {
  await getEntity(id, scope)
  const result = await withTransaction(async (client) => {
    return client.query(
      `SELECT entity_id, seq, event_type, payload, actor, reason, occurred_at, recorded_at
         FROM entity_events
        WHERE entity_id = $1
        ORDER BY seq`,
      [id]
    )
  })
  return result.rows.map(mapEventRow)
}
