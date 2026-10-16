import Ajv from "ajv"
import addFormats from "ajv-formats"
import { v7 as uuidv7 } from "uuid"

import {
  SENTINEL,
  STATUS_LOG_MAX,
  type UmeJson,
  type UmeStatusLogEntry,
} from "./types"

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true })
addFormats(ajv)

export const umeJsonSchema = {
  type: "object",
  required: [
    "id",
    "entityName",
    "dynamicProperties",
    "lifecycle",
    "state",
    "markdownDocumentation",
  ],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    entityName: { type: "string", minLength: 1 },
    dynamicProperties: { type: "object", additionalProperties: true },
    lifecycle: {
      type: "object",
      required: ["createdAt", "updatedAt"],
      additionalProperties: true,
      properties: {
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] },
        version: { type: "integer", minimum: 1 },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["targetEntity", "targetId", "type"],
        additionalProperties: true,
        properties: {
          targetEntity: { type: "string" },
          targetId: { type: "string" },
          type: {
            type: "string",
            enum: [
              "one-to-one",
              "one-to-many",
              "many-to-one",
              "many-to-many",
            ],
          },
          context: { type: "string" },
        },
      },
    },
    state: {
      type: "object",
      required: ["current", "statusLog"],
      additionalProperties: true,
      properties: {
        current: {
          type: "string",
          enum: ["active", "draft", "validation_required"],
        },
        statusLog: {
          type: "array",
          items: {
            type: "object",
            required: ["status", "timestamp"],
            additionalProperties: true,
            properties: {
              status: { type: "string" },
              timestamp: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
    markdownDocumentation: { type: "string" },
  },
} as const

const validateUmeJson = ajv.compile(umeJsonSchema)

export interface SentinelError {
  field: string
  expected: string
  got: unknown
}

export function validateDocument(
  input: unknown
): { valid: true } | { valid: false; errors: unknown } {
  if (validateUmeJson(input)) {
    return { valid: true }
  }
  return { valid: false, errors: validateUmeJson.errors }
}

export function validateSentinels(input: UmeJson): SentinelError[] {
  const errors: SentinelError[] = []

  if (input.id !== SENTINEL && input.id !== null) {
    errors.push({ field: "id", expected: SENTINEL, got: input.id })
  }
  if (
    input.lifecycle.createdAt !== SENTINEL &&
    input.lifecycle.createdAt !== null
  ) {
    errors.push({
      field: "lifecycle.createdAt",
      expected: SENTINEL,
      got: input.lifecycle.createdAt,
    })
  }
  if (
    input.lifecycle.updatedAt !== SENTINEL &&
    input.lifecycle.updatedAt !== null
  ) {
    errors.push({
      field: "lifecycle.updatedAt",
      expected: SENTINEL,
      got: input.lifecycle.updatedAt,
    })
  }
  if (
    input.lifecycle.deletedAt !== undefined &&
    input.lifecycle.deletedAt !== null &&
    input.lifecycle.deletedAt !== SENTINEL
  ) {
    errors.push({
      field: "lifecycle.deletedAt",
      expected: `null | ${SENTINEL}`,
      got: input.lifecycle.deletedAt,
    })
  }
  if (Array.isArray(input.state?.statusLog)) {
    input.state.statusLog.forEach((log: UmeStatusLogEntry, i: number) => {
      if (log.timestamp !== SENTINEL && log.timestamp !== null) {
        errors.push({
          field: `state.statusLog[${i}].timestamp`,
          expected: SENTINEL,
          got: log.timestamp,
        })
      }
    })
  }
  return errors
}

export function finalizeDocument(input: UmeJson): UmeJson {
  const entity = structuredClone(input)
  const nowIso = new Date().toISOString()

  entity.id = uuidv7()

  entity.lifecycle.createdAt = nowIso
  entity.lifecycle.updatedAt = nowIso
  if ("deletedAt" in entity.lifecycle) {
    entity.lifecycle.deletedAt = entity.lifecycle.deletedAt ?? null
  }
  if (typeof entity.lifecycle.version !== "number") {
    entity.lifecycle.version = 1
  }

  if (Array.isArray(entity.state?.statusLog)) {
    entity.state.statusLog = entity.state.statusLog.map((log) => ({
      ...log,
      timestamp:
        log.timestamp === SENTINEL || log.timestamp == null
          ? nowIso
          : log.timestamp,
    }))
    if (entity.state.statusLog.length > STATUS_LOG_MAX) {
      entity.state.statusLog = entity.state.statusLog.slice(-STATUS_LOG_MAX)
    }
  }

  return entity
}
