import { pool } from "@/server/db"
import {
  finalizeDocument,
  validateDocument,
  validateSentinels,
} from "@/server/umejson/schema"
import { createEntity, updateProperties } from "@/server/umejson/repository"
import { AppError, type UmeJson } from "@/server/umejson/types"

import { ACCOUNT_ENTITY_NAME, buildAccountDraft } from "./accounts"
import type { AuthUser, UserRole } from "./types"
import { findUserById } from "./users"

export interface ProfileAccount {
  entityId: string
  version: number
  updatedAt: Date
  fullName: string
  phone: string
}

export interface ProfileData {
  email: string
  role: UserRole
  createdAt: Date
  account: ProfileAccount | null
}

function findAccountProperties(doc: UmeJson): Pick<ProfileAccount, "fullName" | "phone"> {
  const props = doc.dynamicProperties
  return {
    fullName: typeof props.fullName === "string" ? props.fullName : "",
    phone: typeof props.phone === "string" ? props.phone : "",
  }
}

async function findAccountHead(
  userId: string
): Promise<{ id: string; version: number; doc: UmeJson; updatedAt: Date } | null> {
  const result = await pool.query(
    `SELECT id, version, doc, updated_at
       FROM entities
      WHERE entity_name = $1
        AND doc @> jsonb_build_object('dynamicProperties', jsonb_build_object('userId', $2::text))
        AND deleted_at IS NULL
      LIMIT 1`,
    [ACCOUNT_ENTITY_NAME, userId]
  )
  if (!result.rowCount) return null
  return {
    id: result.rows[0].id as string,
    version: result.rows[0].version as number,
    doc: result.rows[0].doc as UmeJson,
    updatedAt: result.rows[0].updated_at as Date,
  }
}

export async function getProfile(userId: string): Promise<ProfileData | null> {
  const user = await findUserById(userId)
  if (!user) return null

  const head = await findAccountHead(userId)
  return {
    email: user.username,
    role: user.role,
    createdAt: user.createdAt,
    account: head
      ? {
          entityId: head.id,
          version: head.version,
          updatedAt: head.updatedAt,
          ...findAccountProperties(head.doc),
        }
      : null,
  }
}

/**
 * Persists profile fields on the account's umeJSON entity, keeping the
 * event-sourced history (property.updated with the diff). Creates the entity
 * if it is missing.
 */
export async function saveProfile(
  user: AuthUser,
  input: { fullName: string; phone: string }
): Promise<{ changed: boolean }> {
  const head = await findAccountHead(user.id)

  if (!head) {
    const draft = buildAccountDraft(user)
    const doc: UmeJson = {
      ...draft,
      dynamicProperties: {
        ...draft.dynamicProperties,
        ...(input.fullName ? { fullName: input.fullName } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
      },
    }

    const validation = validateDocument(doc)
    if (!validation.valid) {
      throw new AppError(
        422,
        "schema_violation",
        "Account entity does not comply with the umeJSON schema",
        validation.errors
      )
    }
    const sentinelErrors = validateSentinels(doc)
    if (sentinelErrors.length > 0) {
      throw new AppError(
        422,
        "sentinel_violation",
        "Account entity has invalid sentinels",
        sentinelErrors
      )
    }

    await createEntity(finalizeDocument(doc), {
      actor: user.username,
      source: "profile",
    })
    return { changed: true }
  }

  const properties: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    const exists = key in head.doc.dynamicProperties
    if (value !== "" || exists) {
      properties[key] = value
    }
  }
  if (Object.keys(properties).length === 0) {
    return { changed: false }
  }

  try {
    await updateProperties(head.id, head.version, properties, {
      actor: user.username,
      reason: "Profile updated",
    })
  } catch (error) {
    if (error instanceof AppError && error.code === "no_changes") {
      return { changed: false }
    }
    throw error
  }
  return { changed: true }
}
