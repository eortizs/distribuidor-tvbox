import { pool } from "@/server/db"
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

export async function insertUser(input: {
  username: string
  passwordHash: string
  role: AuthUser["role"]
}): Promise<UserRow> {
  const result = await pool.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, password_hash, role, created_at`,
    [crypto.randomUUID(), input.username, input.passwordHash, input.role]
  )
  return mapUserRow(result.rows[0])
}
