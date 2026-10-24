import { resolveFlujoConfig } from "./config"
import { FlujoApiError, toFlujoApiError } from "./errors"

export type FlujoMethod = "GET" | "POST"

export type FlujoQueryValue = string | number | boolean | null | undefined

export interface FlujoRequestInit {
  method?: FlujoMethod
  query?: Record<string, FlujoQueryValue>
  body?: unknown
  headers?: Record<string, string>
  /** Lecturas: 30 s. Sesiones de navegador: 120-300 s. */
  timeoutMs?: number
  signal?: AbortSignal
  /** Endpoints públicos (health): no envía la clave. */
  anonymous?: boolean
  /** Clave concreta (prueba de una clave antes de guardarla). */
  apiKey?: string
  /** URL base concreta (prueba contra otro servicio). */
  baseUrl?: string
}

export interface FlujoResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
  durationMs: number
}

export const FLUJO_READ_TIMEOUT_MS = 30_000
export const FLUJO_LONG_TIMEOUT_MS = 300_000

function buildQuery(query?: Record<string, FlujoQueryValue>): string {
  if (!query) return ""
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    params.set(key, String(value))
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ""
}

function collectHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get("retry-after")
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds)
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.round((date - Date.now()) / 1000))
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim().length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * Única puerta de salida hacia la API FlujoTV.
 *
 * La clave viaja SIEMPRE en el header `X-API-Key`: nunca en la query, la
 * cookie o el fragmento, y nunca se registra. Los errores del servicio se
 * traducen a `FlujoApiError` con su código, su mensaje accionable y el
 * `Retry-After` cuando la API está limitando.
 */
export async function flujoRequest<T = unknown>(
  path: string,
  init: FlujoRequestInit = {}
): Promise<FlujoResponse<T>> {
  const config = await resolveFlujoConfig()
  const apiKey = init.apiKey ?? config.apiKey
  const baseUrl = (init.baseUrl ?? config.baseUrl).replace(/\/+$/, "")

  if (!init.anonymous && !apiKey) {
    throw new FlujoApiError(
      503,
      "not_configured",
      "La API de FlujoTV no está configurada. Actívala en Configuración → API de licencias o define FLUJO_API_KEY en el servidor."
    )
  }

  const url = `${baseUrl}${path}${buildQuery(init.query)}`
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...init.headers,
  }
  if (apiKey && !init.anonymous) {
    headers["X-API-Key"] = apiKey
  }

  const timeoutMs = init.timeoutMs ?? FLUJO_READ_TIMEOUT_MS
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
  if (init.signal) signals.push(init.signal)

  let body: string | undefined
  if (init.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json"
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body)
  }

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.any(signals),
      cache: "no-store",
    })
  } catch (error) {
    const aborted =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    if (aborted) {
      throw new FlujoApiError(
        504,
        "timeout",
        `La API de FlujoTV no respondió en ${Math.round(timeoutMs / 1000)} s.`,
        { details: { path } }
      )
    }
    throw new FlujoApiError(
      502,
      "network_error",
      "No se pudo conectar con la API de FlujoTV.",
      {
        details: {
          path,
          cause: error instanceof Error ? error.message : String(error),
        },
      }
    )
  }

  const durationMs = Date.now() - startedAt
  const payload = await readBody(response)
  const responseHeaders = collectHeaders(response.headers)

  if (!response.ok) {
    throw toFlujoApiError(
      response.status,
      payload,
      parseRetryAfter(response.headers)
    )
  }

  return {
    status: response.status,
    data: payload as T,
    headers: responseHeaders,
    durationMs,
  }
}

/**
 * Ejecuta intentos tolerantes a la forma de la API: cada intento es un GET
 * idempotente y solo se encadenan cuando la API rechaza los parámetros
 * (400/422), nunca ante un error de permisos o de límites.
 */
export async function flujoRequestWithFallback<T = unknown>(
  path: string,
  attempts: FlujoRequestInit[],
  init: FlujoRequestInit = {}
): Promise<FlujoResponse<T>> {
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      return await flujoRequest<T>(path, {
        ...init,
        ...attempt,
        query: { ...init.query, ...attempt.query },
        headers: { ...init.headers, ...attempt.headers },
      })
    } catch (error) {
      lastError = error
      const retryable =
        error instanceof FlujoApiError &&
        (error.status === 400 || error.status === 422)
      if (!retryable) throw error
    }
  }
  throw lastError
}
