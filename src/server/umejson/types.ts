export const SENTINEL = "RESERVED_FOR_SYSTEM"

export const ENTITY_STATES = [
  "active",
  "draft",
  "validation_required",
] as const

export type EntityState = (typeof ENTITY_STATES)[number]

export const STATUS_LOG_MAX = 20

export const EVENT_TYPES = [
  "created",
  "property.updated",
  "state.changed",
  "relation.added",
  "annotation.added",
  "imported.from",
  "correction",
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export interface UmeStatusLogEntry {
  status: string
  timestamp: string
  reason?: string
}

export interface UmeRelation {
  targetEntity: string
  targetId: string
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many"
  context?: string
}

export interface UmeLifecycle {
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  version: number
  [key: string]: unknown
}

export interface UmeJson {
  id: string
  entityName: string
  dynamicProperties: Record<string, unknown>
  lifecycle: UmeLifecycle
  relations?: UmeRelation[]
  state: {
    current: string
    statusLog: UmeStatusLogEntry[]
    [key: string]: unknown
  }
  markdownDocumentation: string
  [key: string]: unknown
}

export interface EntityRow {
  id: string
  entityName: string
  doc: UmeJson
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export interface EntityEventRow {
  entityId: string
  seq: number
  eventType: string
  payload: Record<string, unknown>
  actor: string
  reason: string | null
  occurredAt: Date
  recordedAt: Date
}

export class AppError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message)
    this.name = "AppError"
    this.status = status
    this.code = code
    this.details = details
  }
}
