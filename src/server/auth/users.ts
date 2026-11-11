import { pool, type PoolClientLike } from "@/server/db"
import { publishRealtime } from "@/server/realtime/bus"
import { ACCOUNT_ENTITY_NAME } from "./types"
import type { AuthUser } from "./types"

export interface UserRow {
  id: string
  username: string
  /** null en cuentas creadas solo con Google (sin contraseña local). */
  passwordHash: string | null
  /** sub de Google ligado a la cuenta; null si no se autentica vía Google. */
  googleSub: string | null
  /** URL de la foto de perfil de Google; null si no hay o es cuenta local. */
  googlePicture: string | null
  role: AuthUser["role"]
  createdAt: Date
}

function mapUserRow(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    username: row.username as string,
    passwordHash: (row.password_hash as string | null) ?? null,
    googleSub: (row.google_sub as string | null) ?? null,
    googlePicture: (row.google_picture as string | null) ?? null,
    role: row.role as AuthUser["role"],
    createdAt: row.created_at as Date,
  }
}

const USER_SELECT = `
  SELECT id, username, password_hash, google_sub, google_picture, role, created_at
    FROM users`

export async function findUserByUsername(
  username: string
): Promise<UserRow | null> {
  const result = await pool.query(
    `${USER_SELECT} WHERE username = $1`,
    [username]
  )
  return result.rowCount ? mapUserRow(result.rows[0]) : null
}

export async function findUserByGoogleSub(sub: string): Promise<UserRow | null> {
  const result = await pool.query(
    `${USER_SELECT} WHERE google_sub = $1`,
    [sub]
  )
  return result.rowCount ? mapUserRow(result.rows[0]) : null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query(`${USER_SELECT} WHERE id = $1`, [id])
  return result.rowCount ? mapUserRow(result.rows[0]) : null
}

export async function listUsers(): Promise<
  (Omit<UserRow, "passwordHash" | "googleSub" | "googlePicture"> & {
    entityCount: number
    /** Reseller FlujoTV ligado a la cuenta (entidad Cuenta); null si no hay. */
    distribuidorName: string | null
    /** Override de tope diario de cupones; null = valor global del servidor. */
    couponDailyLimit: number | null
    /** Override de tope mensual (acumulado) de cupones; null = global. */
    couponMonthlyLimit: number | null
    /** La cuenta está ligada a Google (google_sub presente). */
    googleLinked: boolean
    /** Saldo en cupones disponible (MXN): licencias de FlujoTV. */
    saldoCupones: number
    /** Saldo en tokens disponible (MXN): herramientas con APIs. */
    saldoTokens: number
  })[]
> {
  const result = await pool.query(
    `SELECT u.id, u.username, u.role, u.created_at, u.google_sub,
            u.coupon_daily_limit, u.coupon_monthly_limit,
            u.saldo_cupones, u.saldo_tokens,
            count(DISTINCT e.id) FILTER (WHERE e.deleted_at IS NULL) AS entity_count,
            max(acc.doc->'dynamicProperties'->>'distribuidorName') AS distribuidor_name
       FROM users u
       LEFT JOIN entities e
         ON e.doc @> jsonb_build_object('dynamicProperties', jsonb_build_object('distribuidorId', u.id))
       LEFT JOIN entities acc
         ON acc.deleted_at IS NULL
        AND acc.entity_name = $1
        AND acc.doc->'dynamicProperties'->>'userId' = u.id::text
        AND acc.doc->'dynamicProperties'->>'distribuidorId' = u.id::text
      GROUP BY u.id
      ORDER BY u.created_at`,
    [ACCOUNT_ENTITY_NAME]
  )
  const positiveIntOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : null
  return result.rows.map((row) => ({
    id: row.id as string,
    username: row.username as string,
    role: row.role as AuthUser["role"],
    createdAt: row.created_at as Date,
    entityCount: Number(row.entity_count),
    distribuidorName:
      typeof row.distribuidor_name === "string" && row.distribuidor_name.length > 0
        ? row.distribuidor_name
        : null,
    couponDailyLimit: positiveIntOrNull(row.coupon_daily_limit),
    couponMonthlyLimit: positiveIntOrNull(row.coupon_monthly_limit),
    googleLinked: typeof row.google_sub === "string" && row.google_sub.length > 0,
    saldoCupones: Number(row.saldo_cupones ?? 0),
    saldoTokens: Number(row.saldo_tokens ?? 0),
  }))
}

export async function insertUser(
  input: {
    username: string
    /** null para cuentas creadas solo con Google. */
    passwordHash: string | null
    role: AuthUser["role"]
    /** sub de Google cuando la cuenta nace de OAuth; null en el resto. */
    googleSub?: string | null
    /** URL de la foto de perfil de Google, si el id_token la trae. */
    googlePicture?: string | null
  },
  executor: PoolClientLike = pool
): Promise<UserRow> {
  const result = await executor.query(
    `INSERT INTO users (id, username, password_hash, role, google_sub, google_picture)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, password_hash, google_sub, google_picture, role, created_at`,
    [
      crypto.randomUUID(),
      input.username,
      input.passwordHash,
      input.role,
      input.googleSub ?? null,
      input.googlePicture ?? null,
    ]
  )
  const user = mapUserRow(result.rows[0])
  await notifyUsersChanged(executor, user.id)
  return user
}

/**
 * Señal de invalidación (SSE) en la misma sesión SQL: dentro de una
 * transacción el NOTIFY sale con el COMMIT; en autocommit sale al instante.
 * Las sesiones del propio usuario lo reciben y refrescan (p. ej. sus
 * permisos de navegación), los admins ven el listado al día.
 */
async function notifyUsersChanged(
  executor: PoolClientLike,
  userId: string
): Promise<void> {
  await publishRealtime(executor, { kind: "users", entityId: userId })
}

export async function updatePassword(
  id: string,
  passwordHash: string
): Promise<void> {
  await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
    id,
    passwordHash,
  ])
}

export async function updateUser(
  id: string,
  input: {
    username?: string
    passwordHash?: string | null
    role?: AuthUser["role"]
    googleSub?: string | null
    googlePicture?: string | null
  },
  executor: PoolClientLike = pool
): Promise<UserRow> {
  const sets: string[] = []
  const values: unknown[] = []

  if (input.username !== undefined) {
    values.push(input.username)
    sets.push(`username = $${values.length}`)
  }
  if (input.passwordHash !== undefined) {
    values.push(input.passwordHash)
    sets.push(`password_hash = $${values.length}`)
  }
  if (input.role !== undefined) {
    values.push(input.role)
    sets.push(`role = $${values.length}`)
  }
  if (input.googleSub !== undefined) {
    values.push(input.googleSub)
    sets.push(`google_sub = $${values.length}`)
  }
  if (input.googlePicture !== undefined) {
    values.push(input.googlePicture)
    sets.push(`google_picture = $${values.length}`)
  }
  if (sets.length === 0) {
    const existing = await findUserByIdIn(id, executor)
    if (!existing) throw new Error(`User ${id} does not exist`)
    return existing
  }

  values.push(id)
  const result = await executor.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING id, username, password_hash, google_sub, google_picture, role, created_at`,
    values
  )
  if (result.rowCount === 0) {
    throw new Error(`User ${id} does not exist`)
  }
  await notifyUsersChanged(executor, id)
  return mapUserRow(result.rows[0])
}

async function findUserByIdIn(
  id: string,
  executor: PoolClientLike
): Promise<UserRow | null> {
  const result = await executor.query(
    "SELECT id, username, password_hash, google_sub, role, created_at FROM users WHERE id = $1",
    [id]
  )
  return result.rowCount ? mapUserRow(result.rows[0]) : null
}

export async function countAdmins(
  executor: PoolClientLike = pool
): Promise<number> {
  const result = await executor.query(
    "SELECT count(*)::int AS count FROM users WHERE role = 'admin'"
  )
  return Number(result.rows[0].count)
}

export async function deleteUser(
  id: string,
  executor: PoolClientLike = pool
): Promise<void> {
  await executor.query("DELETE FROM users WHERE id = $1", [id])
  await notifyUsersChanged(executor, id)
}
