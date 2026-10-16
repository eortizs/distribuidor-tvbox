import { Pool } from "pg"

const globalForPg = globalThis as typeof globalThis & {
  __umePgPool?: Pool
}

function createPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set")
  }
  return new Pool({ connectionString, max: 10 })
}

export const pool: Pool = globalForPg.__umePgPool ?? createPool()

if (process.env.NODE_ENV !== "production") {
  globalForPg.__umePgPool = pool
}

export async function withTransaction<T>(
  fn: (client: PoolClientLike) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export interface PoolClientLike {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Record<string, unknown>[]
    rowCount: number | null
  }>
}
