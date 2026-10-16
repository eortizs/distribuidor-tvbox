import { withTransaction } from "@/server/db"
import {
  finalizeDocument,
  validateDocument,
  validateSentinels,
} from "@/server/umejson/schema"
import { createEntity } from "@/server/umejson/repository"
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
import { insertUser } from "./users"

export const ACCOUNT_ENTITY_NAME = "Cuenta"

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

  try {
    return await withTransaction(async (tx) => {
      const user = await insertUser(
        {
          username: email,
          passwordHash: await hashPassword(input.password),
          role,
        },
        tx
      )

      const draft: UmeJson = {
        id: SENTINEL,
        entityName: ACCOUNT_ENTITY_NAME,
        dynamicProperties: {
          email,
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
        markdownDocumentation: `### ${ACCOUNT_ENTITY_NAME} — ${email}\nCuenta con perfil '${user.role}'.`,
      }

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
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(
        409,
        "email_taken",
        `An account with email '${email}' already exists`
      )
    }
    throw error
  }
}
