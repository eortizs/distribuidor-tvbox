import {
  Pool,
  type PoolClient,
  type QueryConfig,
  type QueryConfigValues,
  type QueryResult,
  type QueryResultRow,
} from "pg"

import { isValidTenantId } from "@/server/tenant/identity"
import type { TenantContext } from "@/server/tenant/context"

/**
 * El contexto de tenant se importa DINÁMICAMENTE: eve evalúa los módulos
 * authored (agent/hooks) con el loader de Node fuera del bundle de Next y
 * `node:async_hooks` no existe en ese sandbox; context.ts (AsyncLocalStorage)
 * debe quedar fuera de la cadena de evaluación estática.
 */
async function tenantDbContext(): Promise<TenantContext | null> {
  const { effectiveDbContext } = await import("@/server/tenant/context")
  return effectiveDbContext()
}

const globalForPg = globalThis as typeof globalThis & {
  __umePgPool?: TenantPool
  __umeSystemPool?: Pool
}

/**
 * Tenancy (§4.3 del plan): `pool` es un TenantPool que FIJA el contexto
 * (app.tenant_id / app.platform) en la conexión antes de cada consulta. Las
 * ~43 órdenes SQL crudas del repo no cambian: la firma de `query` se
 * preserva. La app corre con un rol de BD que NO es dueño ni superuser
 * (`speilink_app`), así que RLS es efectivo y un contexto olvidado ve 0
 * filas (o, con TENANT_STRICT=off, el tenant legado).
 *
 * `systemPool` es el pool crudo SIN contexto, lista blanca: lookup de sesión
 * por token, resolución de host→tenant, búsqueda de orden por código en la
 * ruta pública, listas de trabajo cross-tenant de schedulers, consola de
 * plataforma y webhook de MP.
 */

/** Fija el GUC del contexto (nivel transacción: is_local => true). */
export async function setTenantContextInTx(
  client: PoolClientLike,
  context?: TenantContext
): Promise<void> {
  const effective = context ?? (await tenantDbContext())
  if (!effective) return
  if (effective.platform) {
    await client.query("SELECT set_config('app.platform', 'on', true)")
    return
  }
  if (isValidTenantId(effective.tenantId)) {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      effective.tenantId,
    ])
  }
}

async function setContextInTx(
  client: PoolClientLike,
  context: TenantContext
): Promise<void> {
  return setTenantContextInTx(client, context)
}

/** Fija el GUC a nivel de sesión (clientes crudos; RESET al liberar). */
async function setContextInSession(
  client: PoolClient,
  context: TenantContext
): Promise<void> {
  if (context.platform) {
    await client.query("SELECT set_config('app.platform', 'on', false)")
    return
  }
  if (isValidTenantId(context.tenantId)) {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [
      context.tenantId,
    ])
  }
}

async function resetContextSession(client: PoolClient): Promise<void> {
  await client.query(
    "SELECT set_config('app.tenant_id', '', false), set_config('app.platform', '', false)"
  )
}

async function runTenantQuery<R extends QueryResultRow>(
  pool: Pool,
  text: string | QueryConfig<unknown[]>,
  values: unknown[] | undefined,
  context: TenantContext
): Promise<QueryResult<R>> {
  const client = await pool.connect()
  const sql = typeof text === "string" ? text : text.text
  const params: unknown[] =
    typeof text === "string" ? (values ?? []) : (text.values ?? [])
  try {
    await client.query("BEGIN")
    await setContextInTx(client, context)
    const result = await client.query<R>(sql, params)
    await client.query("COMMIT")
    return result
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // El rollback de una conexión rota falla también: el release limpia.
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Pool con contexto de tenant. Sobrecargas de `@types/pg` preservadas vía
 * la signatura genérica; `connect` sigue exportándose para withTransaction
 * y conTenantClient, que gestionan el contexto explícitamente.
 */
export class TenantPool extends Pool {
  /** Pool crudo subyacente (sin envoltura) para adquisición de clientes. */
  readonly underlying: Pool

  constructor(connectionString: string) {
    super({ connectionString, max: 10 })
    this.underlying = this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preserva la inferencia `any` de @types/pg para no tocar los 43 módulos consumidores
  override async query<R extends QueryResultRow = any, I = any[]>(
    text: string | QueryConfig<I>,
    values?: QueryConfigValues<I>
  ): Promise<QueryResult<R>> {
    const context = await tenantDbContext()
    if (!context) {
      // TENANT_STRICT=on sin contexto: no se fija GUC ⇒ RLS ⇒ 0 filas.
      return super.query<R, I>(text, values)
    }
    return runTenantQuery<R>(
      this.underlying,
      typeof text === "string" ? text : { ...text, values: text.values as unknown[] },
      typeof text === "string" ? (values as unknown[]) : undefined,
      context
    )
  }
}

function createPool(): TenantPool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set")
  }
  return new TenantPool(connectionString)
}

export const pool: TenantPool = globalForPg.__umePgPool ?? createPool()

if (process.env.NODE_ENV !== "production") {
  globalForPg.__umePgPool = pool
}

function createSystemPool(): Pool {
  // La lista blanca corre con un rol DEDICADO con BYPASSRLS
  // (speilink_system, DATABASE_URL_SYSTEM): el mismo rol de la app seguiría
  // sufriendo RLS sin contexto y la lookup de sesión vería 0 filas. Sin la
  // variable (entornos pre-tenancy) degrada a DATABASE_URL.
  const connectionString =
    process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set")
  }
  return new Pool({ connectionString, max: 5 })
}

/**
 * Pool SIN contexto de tenancy (lista blanca, §4.2): lookup de sesión por
 * token, host→tenant, ruta pública del link corto, listas de trabajo
 * cross-tenant, consola de plataforma y webhook de MP.
 */
export const systemPool: Pool = globalForPg.__umeSystemPool ?? createSystemPool()

if (process.env.NODE_ENV !== "production") {
  globalForPg.__umeSystemPool = systemPool
}

export async function withTransaction<T>(
  fn: (client: PoolClientLike) => Promise<T>
): Promise<T> {
  const client = await pool.underlying.connect()
  try {
    await client.query("BEGIN")
    // GUC DENTRO de la transacción (SET LOCAL): todo el bloque corre bajo el
    // contexto actual; sin contexto y con TENANT_STRICT=on, RLS devuelve 0 filas.
    const context = await tenantDbContext()
    if (context) {
      await setContextInTx(client, context)
    }
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

/**
 * Cliente crudo con contexto de tenant a nivel de SESIÓN (locks, COPY,
 * consultas multi-statement sin transacción). El GUC se RESETea antes de
 * liberar la conexión al pool para no contaminar al siguiente usuario.
 */
export async function withTenantClient<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.underlying.connect()
  const context = await tenantDbContext()
  try {
    if (context) {
      await setContextInSession(client, context)
    }
    return await fn(client)
  } finally {
    if (context) {
      try {
        await resetContextSession(client)
      } catch {
        // Conexión rota: el release la saca del pool de todos modos.
      }
    }
    client.release()
  }
}

export interface PoolClientLike {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Record<string, unknown>[]
    rowCount: number | null
  }>
}
