import { withTransaction, type PoolClientLike } from "@/server/db"
import {
  finalizeDocument,
  validateDocument,
  validateSentinels,
} from "@/server/umejson/schema"
import {
  createEntity,
  softDeleteEntitiesByOwner,
  updatePropertiesInTx,
} from "@/server/umejson/repository"
import {
  AppError,
  SENTINEL,
  type UmeJson,
} from "@/server/umejson/types"

import {
  isValidEmail,
  normalizeEmail,
  type AuthUser,
  type UserRole,
} from "./types"
import { hashPassword } from "./password"
import { deleteUser, insertUser, updateUser } from "./users"
import { ensureUserStorage, removeUserStorage } from "@/server/storage/user-files"

export const ACCOUNT_ENTITY_NAME = "Cuenta"

/** Shared draft for the account's umeJSON entity (id/timestamps still sentinel). */
export function buildAccountDraft(user: AuthUser): UmeJson {
  return {
    id: SENTINEL,
    entityName: ACCOUNT_ENTITY_NAME,
    dynamicProperties: {
      email: user.username,
      userId: user.id,
      role: user.role,
      distribuidorId: user.id,
    },
    lifecycle: {
      createdAt: SENTINEL,
      updatedAt: SENTINEL,
      version: 1,
    },
    state: {
      current: "active",
      statusLog: [
        {
          status: "active",
          timestamp: SENTINEL,
          reason: "Account created",
        },
      ],
    },
    markdownDocumentation: `### ${ACCOUNT_ENTITY_NAME} — ${user.username}\nCuenta con perfil '${user.role}'.`,
  }
}

export interface CreateAccountInput {
  email: string
  password: string
  /** Defaults to "distribuidor"; only the admin flow overrides it. */
  role?: UserRole
  actor?: string
  source?: string
}

/**
 * Creates the auth user and its umeJSON account entity atomically.
 * The login is always an email account (validated and normalized here) and
 * the entity carries dynamicProperties.distribuidorId so ownership scoping
 * treats the account as owned by its own user.
 */
export async function createAccount(
  input: CreateAccountInput
): Promise<AuthUser> {
  const email = normalizeEmail(input.email)
  if (!isValidEmail(email)) {
    throw new AppError(
      422,
      "invalid_email",
      "Login must be a valid email address"
    )
  }
  const role: UserRole = input.role ?? "distribuidor"
  let created: AuthUser | null = null

  try {
    created = await withTransaction(async (tx) => {
      const user = await insertUser(
        {
          username: email,
          passwordHash: await hashPassword(input.password),
          role,
        },
        tx
      )

      const draft = buildAccountDraft(user)

      const validation = validateDocument(draft)
      if (!validation.valid) {
        throw new AppError(
          422,
          "schema_violation",
          "Account entity does not comply with the umeJSON schema",
          validation.errors
        )
      }
      const sentinelErrors = validateSentinels(draft)
      if (sentinelErrors.length > 0) {
        throw new AppError(
          422,
          "sentinel_violation",
          "Account entity has invalid sentinels",
          sentinelErrors
        )
      }

      await createEntity(
        finalizeDocument(draft),
        {
          actor: input.actor ?? "system",
          source: input.source ?? "register",
        },
        tx
      )

      return { id: user.id, username: user.username, role: user.role }
    })
    return created
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(
        409,
        "email_taken",
        `An account with email '${email}' already exists`
      )
    }
    throw error
  } finally {
    const ensured = created
    if (ensured) {
      await ensureUserStorage(ensured.id).catch((error) => {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `storage: ensure folder for ${ensured.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        )
      })
    }
  }
}

async function findAccountEntityId(
  client: PoolClientLike,
  userId: string
): Promise<string | null> {
  const result = await client.query(
    `SELECT id FROM entities
      WHERE deleted_at IS NULL
        AND entity_name = $2
        AND doc->'dynamicProperties'->>'userId' = $1`,
    [userId, ACCOUNT_ENTITY_NAME]
  )
  return result.rowCount ? (result.rows[0].id as string) : null
}

/**
 * Updates the auth user and mirrors email/role into its umeJSON account
 * entity (dynamicProperties.email / .role) atomically.
 */
export async function updateAccount(input: {
  userId: string
  username?: string
  role?: UserRole
  passwordHash?: string
  actor: string
}): Promise<AuthUser> {
  try {
    return await withTransaction(async (tx) => {
      const user = await updateUser(
        input.userId,
        {
          username: input.username,
          role: input.role,
          passwordHash: input.passwordHash,
        },
        tx
      )

      const patch: Record<string, string> = {}
      if (input.username !== undefined) patch.email = input.username
      if (input.role !== undefined) patch.role = input.role

      if (Object.keys(patch).length > 0) {
        const entityId = await findAccountEntityId(tx, input.userId)
        if (entityId) {
          const head = await tx.query(
            "SELECT version FROM entities WHERE id = $1 AND deleted_at IS NULL",
            [entityId]
          )
          if (head.rowCount) {
            try {
              await updatePropertiesInTx(
                tx,
                entityId,
                head.rows[0].version as number,
                patch,
                { actor: input.actor, reason: "Account updated" }
              )
            } catch (error) {
              if (
                !(error instanceof AppError && error.code === "no_changes")
              ) {
                throw error
              }
            }
          }
        }
      }

      return { id: user.id, username: user.username, role: user.role }
    })
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(
        409,
        "email_taken",
        `An account with email '${input.username}' already exists`
      )
    }
    throw error
  }
}

/**
 * Deletes the auth user and archives every entity it owns (including its
 * own account entity). Returns the number of archived entities.
 */
export async function deleteAccount(input: {
  userId: string
  actor: string
  reason?: string
}): Promise<number> {
  const archived = await withTransaction(async (tx) => {
    const archived = await softDeleteEntitiesByOwner(
      input.userId,
      {
        actor: input.actor,
        reason: input.reason ?? "Owner account deleted",
      },
      tx
    )
    await deleteUser(input.userId, tx)
    return archived
  })
  await removeUserStorage(input.userId).catch((error) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `storage: remove folder for ${input.userId} failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    )
  })
  return archived
}
