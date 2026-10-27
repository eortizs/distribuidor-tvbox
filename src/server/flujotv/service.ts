import {
  flujoRequest,
  flujoRequestWithFallback,
  FLUJO_LONG_TIMEOUT_MS,
  FLUJO_READ_TIMEOUT_MS,
  type FlujoMethod,
} from "./client"
import { resolveFlujoConfig } from "./config"
import { FlujoApiError } from "./errors"
import type {
  FlujoClient,
  FlujoHealth,
  FlujoLicenseRecord,
  FlujoRawResult,
  FlujoRenewalResult,
  FlujoResellersResponse,
  FlujoStatus,
  RenewalMonths,
} from "@/lib/flujotv"

/* -------------------------------------------------------------------------- */
/*                             Lectura tolerante                               */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * La API devuelve colecciones en envoltorios distintos según el endpoint
 * (`[...]`, `{ clients: [...] }`, `{ data: { items: [...] } }`). Se busca el
 * primer arreglo alcanzable con los nombres esperados.
 */
function findArray(
  payload: unknown,
  keys: string[]
): unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return null
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value
  }
  for (const value of Object.values(payload)) {
    if (isRecord(value)) {
      const nested = findArray(value, keys)
      if (nested) return nested
    }
  }
  return null
}

function pickString(
  source: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}

function pickNumber(
  source: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value.replace(/[^0-9.\-]/g, ""))
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function pickBoolean(
  source: Record<string, unknown>,
  keys: string[]
): boolean | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "boolean") return value
  }
  return null
}

/* -------------------------------------------------------------------------- */
/*                              Normalización                                  */
/* -------------------------------------------------------------------------- */

const STATUS_ALIASES: Record<string, string> = {
  active: "activo",
  activo: "activo",
  activa: "activo",
  enabled: "activo",
  vigente: "activo",
  valida: "activo",
  válido: "activo",
  valid: "activo",
  true: "activo",
  expired: "vencido",
  vencido: "vencido",
  vencida: "vencido",
  inactive: "vencido",
  cancelado: "vencido",
  cancelada: "vencido",
  false: "vencido",
  pending: "pendiente",
  pendiente: "pendiente",
  por_vencer: "pendiente",
  trial: "prueba",
  prueba: "prueba",
  demo: "prueba",
}

function normalizeStatus(value: string | null): string | null {
  if (!value) return null
  const key = value.trim().toLowerCase()
  return STATUS_ALIASES[key] ?? value.trim()
}

const CLIENT_USER_KEYS = [
  "user_name",
  "userName",
  "username",
  "user",
  "nombre_usuario",
  "nombre",
  "name",
]

const CLIENT_EMAIL_KEYS = ["email", "correo", "correo_electronico", "mail"]
const CLIENT_STATUS_KEYS = ["status", "estado", "state", "situacion"]
const CLIENT_EXPIRES_KEYS = [
  "end_date",
  "expires_at",
  "expiration",
  "expiry",
  "fecha_expiracion",
  "expired_at",
  "vence",
  "vence_el",
  "until",
  "new_expiration",
]
const CLIENT_DAYS_KEYS = [
  "days_remaining",
  "dias_restantes",
  "remaining_days",
  "days_left",
  "dias",
]
const CLIENT_PLAN_KEYS = ["plan", "package", "membership", "tipo", "tipo_plan"]
const CLIENT_PASSWORD_KEYS = ["password", "contrasena", "contraseña", "clave"]
const CLIENT_NOTES_KEYS = ["notes", "notas", "comment", "comentario"]

function daysBetween(target: string): number | null {
  const parsed = Date.parse(target)
  if (Number.isNaN(parsed)) return null
  const now = Date.now()
  return Math.ceil((parsed - now) / 86_400_000)
}

export function normalizeClient(
  raw: Record<string, unknown>,
  index: number
): FlujoClient {
  const userName = pickString(raw, CLIENT_USER_KEYS) ?? `#${index + 1}`
  const email = pickString(raw, CLIENT_EMAIL_KEYS)
  const explicitStatus = pickString(raw, CLIENT_STATUS_KEYS)
  const expiresAt = pickString(raw, CLIENT_EXPIRES_KEYS)

  let status = normalizeStatus(explicitStatus)
  if (!status && expiresAt) {
    const days = daysBetween(expiresAt)
    if (days !== null) status = days < 0 ? "vencido" : "activo"
  }
  if (!status) {
    const active = pickBoolean(raw, ["active", "is_active", "activo"])
    if (active !== null) status = active ? "activo" : "vencido"
  }

  const daysRemaining =
    pickNumber(raw, CLIENT_DAYS_KEYS) ??
    (expiresAt ? daysBetween(expiresAt) : null)

  const password = pickString(raw, CLIENT_PASSWORD_KEYS)
  const notes = pickString(raw, CLIENT_NOTES_KEYS)

  return {
    id: userName,
    userName,
    email,
    status,
    statusLabel: status ?? "desconocido",
    expiresAt,
    daysRemaining,
    plan: pickString(raw, CLIENT_PLAN_KEYS),
    hasCredentials: password !== null || notes !== null,
    password,
    notes,
    raw,
  }
}

const LICENSE_USER_KEYS = ["user_name", "userName", "username", "cliente", "user"]
const LICENSE_MONTHS_KEYS = ["months", "meses", "duracion", "duration"]
const LICENSE_AMOUNT_KEYS = ["amount", "monto", "precio", "price", "total", "costo"]
const LICENSE_CURRENCY_KEYS = ["currency", "moneda"]
const LICENSE_ISSUED_KEYS = [
  "issued_at",
  "created_at",
  "fecha",
  "date",
  "fecha_emision",
  "emision",
  "purchase_date",
]
const LICENSE_EXPIRES_KEYS = [
  "expires_at",
  "expiration",
  "expiry",
  "fecha_expiracion",
  "vence",
  "new_expiration",
  "new_expires_at",
]
const LICENSE_STATUS_KEYS = ["status", "estado", "result", "resultado"]

export function normalizeLicense(
  raw: Record<string, unknown>,
  index: number
): FlujoLicenseRecord {
  const userName = pickString(raw, LICENSE_USER_KEYS)
  const months = pickNumber(raw, LICENSE_MONTHS_KEYS)
  const issuedAt = pickString(raw, LICENSE_ISSUED_KEYS)
  const expiresAt = pickString(raw, LICENSE_EXPIRES_KEYS)

  return {
    id: pickString(raw, ["id", "license_id", "record_id"]) ?? `${userName ?? "licencia"}-${index}`,
    userName,
    months,
    amount: pickNumber(raw, LICENSE_AMOUNT_KEYS),
    currency: pickString(raw, LICENSE_CURRENCY_KEYS),
    issuedAt,
    expiresAt,
    status: normalizeStatus(pickString(raw, LICENSE_STATUS_KEYS)),
    raw,
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Endpoints                                  */
/* -------------------------------------------------------------------------- */

/**
 * Resultado de probar una clave contra la API sin guardarla.
 */
export type FlujoProbeResult =
  | { ok: true; status: number; message: string }
  | {
      ok: false
      status: number | null
      code: string
      message: string
      retryAfter: number | null
    }

/**
 * Comprueba una clave contra la API de licencias sin guardarla.
 *
 * Se llama a un endpoint de lectura (`/get_clients` y, si no existe,
 * `/licencias`): un 200 confirma la clave, un 401 la descarta, un 403 avisa de
 * que falta un scope.
 */
export async function probeFlujoApiKey(input: {
  apiKey: string
  baseUrl: string
}): Promise<FlujoProbeResult> {
  const attempts: { path: string; query: Record<string, number> }[] = [
    { path: "/get_clients", query: { limit: 1 } },
    { path: "/licencias", query: { limit: 1 } },
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      await flujoRequestWithFallback<unknown>(
        attempt.path,
        [{ query: attempt.query }, { query: {} }],
        {
          method: "GET",
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          timeoutMs: FLUJO_READ_TIMEOUT_MS,
        }
      )
      return {
        ok: true,
        status: 200,
        message: "La clave es válida: la API de licencias responde.",
      }
    } catch (error) {
      lastError = error
      if (error instanceof FlujoApiError && error.status === 404) continue
      if (error instanceof FlujoApiError) {
        return {
          ok: false,
          status: error.status,
          code: error.code,
          message: error.message,
          retryAfter: error.retryAfter,
        }
      }
      break
    }
  }

  if (lastError instanceof FlujoApiError) {
    return {
      ok: false,
      status: lastError.status,
      code: lastError.code,
      message: lastError.message,
      retryAfter: lastError.retryAfter,
    }
  }

  return {
    ok: false,
    status: null,
    code: "unknown_error",
    message: "No se pudo comprobar la clave contra la API de licencias.",
    retryAfter: null,
  }
}

export async function getFlujoHealth(): Promise<FlujoHealth> {
  try {
    const response = await flujoRequest<Record<string, unknown>>("/health", {
      anonymous: true,
      timeoutMs: 15_000,
    })
    const data = isRecord(response.data) ? response.data : {}
    return {
      reachable: true,
      status: pickString(data, ["status", "estado"]),
      version: pickString(data, ["version", "api_version"]),
      error: null,
    }
  } catch (error) {
    return {
      reachable: false,
      status: null,
      version: null,
      error:
        error instanceof Error
          ? error.message
          : "No se pudo consultar el estado de la API.",
    }
  }
}

export async function getFlujoStatus(): Promise<FlujoStatus> {
  const config = await resolveFlujoConfig()
  return {
    configured: config.apiKey !== null,
    baseUrl: config.baseUrl,
    keySource: config.keySource,
    maskedKey: config.maskedKey,
    updatedAt: config.updatedAt,
    health: await getFlujoHealth(),
  }
}

export interface ListClientsOptions {
  query?: string
  limit?: number
  offset?: number
  includeCredentials?: boolean
  full?: boolean
}

/**
 * Lista clientes del panel. Con `query` usa el endpoint de búsqueda; sin él,
 * el listado completo. Los parámetros de paging se prueban primero y se
 * abandonan si la API los rechaza.
 */
export async function listFlujoClients(
  options: ListClientsOptions = {}
): Promise<{ clients: FlujoClient[]; total: number | null; endpoint: string }> {
  const limit = options.limit ?? 200
  const offset = options.offset ?? 0
  const extra: Record<string, string | number | boolean> = {}
  if (options.includeCredentials) extra.include_credentials = "true"
  if (options.full) extra.full = "true"

  const query = options.query?.trim()
  const endpoint = query ? "/search_clients" : "/get_clients"

  const attempts = query
    ? [
        { query: { q: query, limit, offset, ...extra } },
        { query: { q: query, ...extra } },
        { query: { query, ...extra } },
        { query: { ...extra } },
      ]
    : [
        { query: { limit, offset, ...extra } },
        { query: { ...extra } },
      ]

  const response = await flujoRequestWithFallback<unknown>(
    endpoint,
    attempts,
    {
      method: "GET",
      timeoutMs: FLUJO_READ_TIMEOUT_MS,
    }
  )

  const rows = findArray(response.data, [
    "clients",
    "clientes",
    "users",
    "usuarios",
    "items",
    "results",
    "data",
  ])
  const list = rows ?? []
  const clients = list
    .filter(isRecord)
    .map((row, index) => normalizeClient(row, index))

  const total =
    isRecord(response.data)
      ? pickNumber(response.data, ["total", "count", "total_count"])
      : null

  return { clients, total, endpoint }
}

/**
 * Lista los resellers del panel con sus clientes asignados. Es una lectura de
 * disponibilidad: la API responde desde su caché, así que junto al listado se
 * devuelve la antigüedad reportada para que el operador sepa qué tan fresco
 * es el dato.
 */
export async function listFlujoResellers(): Promise<FlujoResellersResponse> {
  // El `search_term` vacío viaja en la ruta porque buildQuery descarta los
  // valores vacíos: sin él, la API aplica su término por defecto y sirve la
  // caché de otro término en lugar del listado completo.
  const response = await flujoRequest<unknown>("/resellers?search_term=", {
    method: "GET",
    timeoutMs: FLUJO_READ_TIMEOUT_MS,
  })

  const meta = isRecord(response.data) ? response.data : {}

  // La API señala fallo con HTTP 200 y `success: false` (p. ej. sin caché
  // para el término): se propaga como error en vez de listado vacío.
  if (meta.success === false) {
    throw new FlujoApiError(
      502,
      "upstream_error",
      pickString(meta, ["message", "detail", "error"]) ??
        "La API de FlujoTV no pudo entregar la disponibilidad de resellers.",
      { details: response.data }
    )
  }

  const rows = findArray(response.data, [
    "resellers",
    "items",
    "results",
    "data",
  ])
  const resellers = (rows ?? []).filter(isRecord).map((row, index) => {
    const name =
      pickString(row, ["name", "nombre", "reseller", "user_name", "username"]) ??
      `#${index + 1}`
    return {
      id: name,
      name,
      clientsCount: pickNumber(row, [
        "clients_count",
        "clientsCount",
        "clients",
        "clientes",
        "total_clients",
      ]),
      raw: row,
    }
  })

  return {
    resellers,
    totalResellers: pickNumber(meta, [
      "total_resellers",
      "totalResellers",
      "total",
    ]),
    clientsWithoutDistributor: pickNumber(meta, [
      "clients_without_distributor",
      "clients_without_reseller",
      "clientsWithoutDistributor",
      "clientsWithoutReseller",
    ]),
    fromCache: pickBoolean(meta, ["from_cache", "fromCache"]),
    cacheAge: pickString(meta, ["cache_age", "cacheAge"]),
    searchTerm: pickString(meta, ["search_term", "searchTerm"]),
    endpoint: "/resellers",
  }
}

export async function getFlujoClient(
  userName: string,
  options: { includeCredentials?: boolean; full?: boolean } = {}
): Promise<FlujoClient | null> {
  const extra: Record<string, string | number | boolean> = {}
  if (options.includeCredentials) extra.include_credentials = "true"
  if (options.full) extra.full = "true"

  const response = await flujoRequestWithFallback<unknown>(
    "/find_user",
    [
      { query: { user_name: userName, ...extra } },
      { query: { username: userName, ...extra } },
      { query: { user: userName, ...extra } },
    ],
    { method: "GET", timeoutMs: FLUJO_READ_TIMEOUT_MS }
  )

  if (isRecord(response.data)) {
    const nested = findArray(response.data, ["client", "user", "cliente", "data"])
    if (nested && nested.length > 0 && isRecord(nested[0])) {
      return normalizeClient(nested[0], 0)
    }
    const rows = findArray(response.data, ["clients", "users", "items", "results"])
    if (rows && rows.length > 0 && isRecord(rows[0])) {
      return normalizeClient(rows[0], 0)
    }
    return normalizeClient(response.data, 0)
  }

  return null
}

export async function getFlujoLicenses(): Promise<{
  licenses: FlujoLicenseRecord[]
  endpoint: string
}> {
  const response = await flujoRequest<unknown>("/licencias", {
    method: "GET",
    timeoutMs: FLUJO_READ_TIMEOUT_MS,
  })

  const rows = findArray(response.data, [
    "licencias",
    "licenses",
    "historial",
    "history",
    "items",
    "results",
    "data",
  ])
  const licenses = (rows ?? [])
    .filter(isRecord)
    .map((row, index) => normalizeLicense(row, index))

  return { licenses, endpoint: "/licencias" }
}

/**
 * Renueva una licencia. El `Idempotency-Key` es obligatorio: la misma clave
 * con el mismo payload devuelve la misma renovación, y la misma clave con otro
 * payload responde 409.
 */
export async function renewFlujoLicense(params: {
  userName: string
  months: RenewalMonths
  idempotencyKey: string
}): Promise<FlujoRenewalResult> {
  const encoded = encodeURIComponent(params.userName)
  const response = await flujoRequest<unknown>(
    `/licenses/${encoded}/renewals`,
    {
      method: "POST",
      body: { months: params.months },
      headers: { "Idempotency-Key": params.idempotencyKey },
      timeoutMs: FLUJO_LONG_TIMEOUT_MS,
    }
  )

  return {
    status: response.status,
    durationMs: response.durationMs,
    payload: response.data,
  }
}

/**
 * Refresco real contra el panel de FlujoTV. Cuesta ~90 s y solo se dispara
 * cuando el operador lo pide de forma explícita.
 */
export async function refreshFlujoCache(
  target: "list_clients" | "cache"
): Promise<FlujoRawResult> {
  const path = target === "cache" ? "/cache" : "/list_clients"
  const response = await flujoRequest<unknown>(path, {
    method: "GET",
    timeoutMs: FLUJO_LONG_TIMEOUT_MS,
  })
  return {
    status: response.status,
    durationMs: response.durationMs,
    headers: response.headers,
    payload: response.data,
  }
}

/* -------------------------------------------------------------------------- */
/*                              Consola cruda                                 */
/* -------------------------------------------------------------------------- */

const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/

const SECRET_KEY_PATTERN =
  /(api[_-]?key|apikey|secret|token|password|passwd|credential|idempotency)/i

/** Oculta valores sensibles antes de devolverlos al navegador. */
function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return value
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key)
      ? "«oculto»"
      : redactSecrets(item, depth + 1)
  }
  return result
}

export interface RawRequestInput {
  method: FlujoMethod
  path: string
  query?: string
  body?: string
}

/**
 * Paso directo de la consola del laboratorio a la API. Solo GET y POST, y
 * solo rutas relativas: la URL siempre es la base configurada, así que la
 * consola no puede salir del servicio FlujoTV.
 */
export async function flujoRawRequest(
  input: RawRequestInput
): Promise<FlujoRawResult> {
  const path = input.path.trim()
  if (!path.startsWith("/")) {
    throw new FlujoApiError(
      400,
      "invalid_path",
      "La ruta debe empezar por «/»."
    )
  }
  if (!SAFE_PATH.test(path) || path.includes("..")) {
    throw new FlujoApiError(
      400,
      "invalid_path",
      "La ruta contiene caracteres no permitidos."
    )
  }

  const query: Record<string, string> = {}
  for (const pair of (input.query ?? "").split("&")) {
    const trimmed = pair.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf("=")
    const key = separator === -1 ? trimmed : trimmed.slice(0, separator)
    const value = separator === -1 ? "" : trimmed.slice(separator + 1)
    if (key.length === 0) continue
    query[decodeURIComponent(key)] = decodeURIComponent(value)
  }

  const isLong =
    path === "/list_clients" ||
    path === "/cache" ||
    path.startsWith("/sessions")

  const init: Parameters<typeof flujoRequest>[1] = {
    method: input.method,
    query,
    timeoutMs: isLong ? FLUJO_LONG_TIMEOUT_MS : FLUJO_READ_TIMEOUT_MS,
  }

  if (input.method === "POST" && input.body && input.body.trim().length > 0) {
    const raw = input.body.trim()
    try {
      init.body = JSON.parse(raw) as unknown
    } catch {
      init.body = raw
    }
  }

  const response = await flujoRequest<unknown>(path, init)

  return {
    status: response.status,
    durationMs: response.durationMs,
    headers: response.headers,
    payload: redactSecrets(response.data),
  }
}
