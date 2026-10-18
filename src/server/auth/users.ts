import { pool, type PoolClientLike } from "@/server/db"
import type { AuthUser } from "./types"

export interface UserRow {
  id: string
  username: string
  passwordHash: string
  role: AuthUser["role"]
  createdAt: Date
}

function mapUserRow(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    role: row.role as AuthUser["role"],
    createdAt: row.created_at as Date,
  }
}

export async function findUserByUsername(
  username: string
): Promise<UserRow | null> {
  const result = await pool.query(
    "SELECT id, username, password_hash, role, created_at FROM users WHERE username = $1",
    [username]
  )
  return result.rowCount ? mapUserRow(result.rows[0]) : null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query(
    "SELECT id, username, password_hash, role, created_at FROM users WHERE id = $1",
    [id]
  )
  return result.rowCount ? mapUserRow(result.rows[0]) : null
}

export async function listUsers(): Promise<
  (Omit<UserRow, "passwordHash"> & { entityCount: number })[]
> {
  const result = await pool.query(
    `SELECT u.id, u.username, u.role, u.created_at,
            count(e.id) FILTER (WHERE e.deleted_at IS NULL) AS entity_count
       FROM users u
       LEFT JOIN entities e
         ON e.doc @> jsonb_build_object('dynamicProperties', jsonb_build_object('distribuidorId', u.id))
      GROUP BY u.id
      ORDER BY u.created_at`
  )
  return result.rows.map((row) => ({
    id: row.id as string,
    username: row.username as string,
    role: row.role as AuthUser["role"],
    createdAt: row.created_at as Date,
    entityCount: Number(row.entity_count),
  }))
}

export async function insertUser(
  input: {
    username: string
    passwordHash: string
    role: AuthUser["role"]
  },
  executor: PoolClientLike = pool
): Promise<UserRow> {
  const result = await executor.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, password_hash, role, created_at`,
    [crypto.randomUUID(), input.username, input.passwordHash, input.role]
  )
  return mapUserRow(result.rows[0])
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
    passwordHash?: string
    role?: AuthUser["role"]
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
  if (sets.length === 0) {
    const existing = await findUserByIdIn(id, executor)
    if (!existing) throw new Error(`User ${id} does not exist`)
    return existing
  }

  values.push(id)
  const result = await executor.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING id, username, password_hash, role, created_at`,
    values
  )
  if (result.rowCount === 0) {
    throw new Error(`User ${id} does not exist`)
  }
  return mapUserRow(result.rows[0])
}

async function findUserByIdIn(
  id: string,
  executor: PoolClientLike
): Promise<UserRow | null> {
  const result = await executor.query(
    "SELECT id, username, password_hash, role, created_at FROM users WHERE id = $1",
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
}
