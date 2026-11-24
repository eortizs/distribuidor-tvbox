import { AsyncLocalStorage } from "node:async_hooks"

import { readRequestCookies, readRequestHeaders } from "./request-store"

async function systemDb() {
  const { systemPool } = await import("@/server/db")
  return systemPool
}

async function sessionLookup() {
  return import("@/server/auth/session-lookup")
}
import {
  hostTenantIdForRequest,
  isValidTenantId,
  validateSessionHost,
} from "./identity"

/**
 * Contexto de tenancy por petición/job (§4.2 del plan).
 *
 * La fuente de verdad para el aislamiento es AsyncLocalStorage: `pool.query`
 * (src/server/db.ts) lee el store y fija `app.tenant_id` / `app.platform` en
 * la conexión antes de cada consulta; RLS hace el resto.
 *
 * Orden de resolución de `effectiveDbContext()`:
 * 1. ALS explícito (runWithTenant / runAsPlatform): jobs, socket, webhook,
 *    ruta pública del link corto.
 * 2. Petición HTTP SIN store: se resuelve desde `headers()` de Next (el
 *    request store de Next sí aísla por petición — `enterWith` NO cruza las
 *    fronteras de Next de forma fiable): cookie de sesión ⇒ tenant del
 *    usuario + validación host ↔ tenant; sin cookie ⇒ tenant del HOST
 *    (login/registro). Memoizado por identidad de headers (1 lookup por
 *    petición, no por consulta).
 * 3. Sin request (schedulers antes de runWithTenant) o host sin tenant:
 *    null. Con TENANT_STRICT=on NO se fija GUC y RLS devuelve 0 filas
 *    (falla cerrado); con el default (off) se degrada al tenant legado
 *    para que el panel actual siga funcionando durante la migración.
 */

export interface TenantContext {
  /** uuid del tenant activo; null con platform=true. */
  tenantId: string | null
  /** Contexto de consola de plataforma (ve todo). */
  platform: boolean
  /** Origen del contexto, para trazabilidad en logs. */
  source: "explicit" | "session" | "host" | "fallback"
}

// Import explícito de node:async_hooks y NO el global AsyncLocalStorage: ese
// global lo crea Next de forma perezosa en su propio runtime, y en el runtime
// de eve (agent/channels, agent/tools) este módulo llegaba a evaluarse antes
// de que existiera y reventaba con ReferenceError.
const als = new AsyncLocalStorage<TenantContext>()

/** Devuelve el store actual SIN fallback (lecturas crudas). */
export function currentTenantContext(): TenantContext | null {
  return als.getStore() ?? null
}

/** Corre `fn` bajo el contexto del tenant dado (jobs, socket, webhook). */
export async function runWithTenant<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  const context: TenantContext = {
    tenantId,
    platform: false,
    source: "explicit",
  }
  return als.run(context, fn)
}

/** Corre `fn` como consola de plataforma (ve todos los tenants). */
export async function runAsPlatform<T>(fn: () => Promise<T>): Promise<T> {
  const context: TenantContext = {
    tenantId: null,
    platform: true,
    source: "explicit",
  }
  return als.run(context, fn)
}

/**
 * DUAL (consola de plataforma creando/ajustando UN tenant): fija
 * app.platform=on Y app.tenant_id=<id> — las políticas pasan por plataforma
 * y el trigger de tenant_id rellena las filas nuevas con el tenant dado.
 */
export async function runWithPlatformTenant<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  const context: TenantContext = {
    tenantId,
    platform: true,
    source: "explicit",
  }
  return als.run(context, fn)
}

/**
 * Contexto de la petición HTTP desde headers() de Next, memoizado por
 * identidad del objeto de headers (uno por petición en el runtime).
 */
const requestContextMemo = new WeakMap<
  ReadonlyMap<string, string> | object,
  Promise<TenantContext | null>
>()

async function resolveRequestContext(): Promise<TenantContext | null> {
  const headerStore = await readRequestHeaders()
  if (!headerStore) return null
  const memo = requestContextMemo.get(headerStore)
  if (memo) return memo

  const promise = (async (): Promise<TenantContext | null> => {
    const raw =
      headerStore.get("x-forwarded-host")?.split(",")[0] ??
      headerStore.get("host") ??
      ""
    const host = raw.split(":")[0]?.trim().toLowerCase() ?? ""

    const cookieStore = await readRequestCookies()
    const token = cookieStore?.get((await sessionLookup()).SESSION_COOKIE)?.value
    if (token) {
      const lookup = await sessionLookup()
      const session = await lookup
        .findSessionUser(await systemDb(), token)
        .catch(() => null)
      if (
        session &&
        session.tenantStatus !== "suspended" &&
        validateSessionHost(session.tenantId, host)
      ) {
        return {
          tenantId: session.tenantId,
          platform: false,
          source: "session",
        }
      }
      if (session) return null // cookie válida pero de otro host: sin datos
    }

    // Anónimo: el tenant del HOST acota login/registro (null = host sin
    // tenant: short/unknown/plataforma anónima ⇒ sin contexto).
    const hostTenantId = await hostTenantIdForRequest(host).catch(() => null)
    if (hostTenantId && isValidTenantId(hostTenantId)) {
      return { tenantId: hostTenantId, platform: false, source: "host" }
    }
    return null
  })()
  requestContextMemo.set(headerStore, promise)
  return promise
}

/**
 * Contexto efectivo para la BD (ver doc del módulo para el orden). NUNCA
 * lanza: fuera de un request (schedulers sin wrapper) devuelve null.
 */
export async function effectiveDbContext(): Promise<TenantContext | null> {
  const store = als.getStore()
  if (store) return store
  try {
    const resolved = await resolveRequestContext()
    if (resolved) return resolved
  } catch {
    // headers() fuera de request scope (job, build): cae al fallback.
  }
  if (strictTenantMode()) return null
  return {
    tenantId: LEGACY_TENANT_ID_FALLBACK,
    platform: false,
    source: "fallback",
  }
}

/**
 * Fallback del periodo de migración: el tenant legado se resuelve una vez
 * (id constante compartido con db/tenants-schema.sql).
 */
const LEGACY_TENANT_ID_FALLBACK = "8e83b5cc-9f43-28b2-a8f3-2882fef090a8"

export function strictTenantMode(): boolean {
  return (process.env.TENANT_STRICT || "off").toLowerCase() === "on"
}

/** (Compat) fija el store para el resto del contexto async actual. */
export function setRequestContext(
  context: Omit<TenantContext, "source"> & { source?: TenantContext["source"] }
): void {
  als.enterWith({
    tenantId: context.tenantId,
    platform: context.platform,
    source: context.source ?? "session",
  })
}

/** Cache de 30 s de tenant por usuario (memo de rendimiento, no fuente). */
const tenantOfUserCache = new Map<string, { tenantId: string | null; at: number }>()
const TENANT_LOOKUP_TTL_MS = 30_000
const TENANT_LOOKUP_CACHE_MAX = 5_000

function pruneCache(): void {
  if (tenantOfUserCache.size <= TENANT_LOOKUP_CACHE_MAX) return
  const now = Date.now()
  for (const [key, value] of tenantOfUserCache) {
    if (now - value.at > TENANT_LOOKUP_TTL_MS) tenantOfUserCache.delete(key)
  }
}

/**
 * Tenant de un usuario (fuente única de verdad: users.tenant_id). Lectura
 * systemPool: la resolución del contexto no puede depender del contexto.
 */
export async function tenantIdOfUser(userId: string): Promise<string | null> {
  const cached = tenantOfUserCache.get(userId)
  const now = Date.now()
  if (cached && now - cached.at < TENANT_LOOKUP_TTL_MS) {
    return cached.tenantId
  }
  const result = await (await systemDb()).query(
    "SELECT tenant_id FROM users WHERE id = $1",
    [userId]
  )
  const tenantId = (result.rows[0]?.tenant_id as string | null) ?? null
  pruneCache()
  tenantOfUserCache.set(userId, { tenantId, at: now })
  return tenantId
}

export interface TenantRow {
  id: string
  slug: string
  name: string
  kind: "legacy" | "business"
  status: "active" | "suspended"
  modules: string[]
  usePlatformMpAccount: boolean
  whatsappNumber: string | null
  whatsappLinkedAt: Date | null
  whatsappLastSeenAt: Date | null
  bankName: string | null
  bankHolder: string | null
  bankClabe: string | null
}

function mapTenantRow(row: Record<string, unknown>): TenantRow {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    kind: row.kind as TenantRow["kind"],
    status: row.status as TenantRow["status"],
    modules: (row.modules as string[] | null) ?? [],
    usePlatformMpAccount: Boolean(row.use_platform_mp_account),
    whatsappNumber: (row.whatsapp_number as string | null) ?? null,
    whatsappLinkedAt: (row.whatsapp_linked_at as Date | null) ?? null,
    whatsappLastSeenAt: (row.whatsapp_last_seen_at as Date | null) ?? null,
    bankName: (row.bank_name as string | null) ?? null,
    bankHolder: (row.bank_holder as string | null) ?? null,
    bankClabe: (row.bank_clabe as string | null) ?? null,
  }
}

const cacheTenantBySlug = new Map<
  string,
  { row: TenantRow | null; at: number }
>()
const cacheTenantById = new Map<
  string,
  { row: TenantRow | null; at: number }
>()

function pruneTenantCaches(): void {
  const now = Date.now()
  for (const [key, value] of cacheTenantBySlug) {
    if (now - value.at > TENANT_LOOKUP_TTL_MS) cacheTenantBySlug.delete(key)
  }
  for (const [key, value] of cacheTenantById) {
    if (now - value.at > TENANT_LOOKUP_TTL_MS) cacheTenantById.delete(key)
  }
}

const TENANT_SELECT = `
  SELECT id, slug, name, kind, status, modules, use_platform_mp_account,
         whatsapp_number, whatsapp_linked_at, whatsapp_last_seen_at,
         bank_name, bank_holder, bank_clabe
    FROM tenants`

/** Tenant por slug (host resolution; whitelist systemPool). Cache 30 s. */
export async function findTenantBySlug(
  slug: string
): Promise<TenantRow | null> {
  const cached = cacheTenantBySlug.get(slug)
  const now = Date.now()
  if (cached && now - cached.at < TENANT_LOOKUP_TTL_MS) return cached.row
  const result = await (await systemDb()).query(
    `${TENANT_SELECT} WHERE slug = $1`,
    [slug]
  )
  const row = result.rowCount ? mapTenantRow(result.rows[0]) : null
  pruneTenantCaches()
  cacheTenantBySlug.set(slug, { row, at: now })
  return row
}

/** Tenant por id (schedulers, WhatsApp; whitelist systemPool). Cache 30 s. */
export async function findTenantById(id: string): Promise<TenantRow | null> {
  const cached = cacheTenantById.get(id)
  const now = Date.now()
  if (cached && now - cached.at < TENANT_LOOKUP_TTL_MS) return cached.row
  const result = await (await systemDb()).query(
    `${TENANT_SELECT} WHERE id = $1`,
    [id]
  )
  const row = result.rowCount ? mapTenantRow(result.rows[0]) : null
  pruneTenantCaches()
  cacheTenantById.set(id, { row, at: now })
  return row
}

/**
 * Lista de tenants activos para schedulers y consola (whitelist systemPool:
 * las listas de trabajo son cross-tenant por definición).
 */
export async function listActiveTenants(): Promise<TenantRow[]> {
  const result = await (
    await systemDb()
  ).query(`${TENANT_SELECT} WHERE status = 'active' ORDER BY created_at`)
  return result.rows.map(mapTenantRow)
}

/** El tenant legado (fallback de la migración; whitelist systemPool). */
export async function findLegacyTenant(): Promise<TenantRow> {
  const result = await (
    await systemDb()
  ).query(`${TENANT_SELECT} WHERE kind = 'legacy' LIMIT 1`)
  if (!result.rowCount) {
    throw new Error(
      "legacy tenant missing: run db/apply-tenants.mjs before starting the app"
    )
  }
  return mapTenantRow(result.rows[0])
}
