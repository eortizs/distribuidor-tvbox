import {
  MERCADOPAGO_API_BASE,
  resolveMercadoPagoConfig,
} from "./config"
import { MercadoPagoError, toMercadoPagoError } from "./errors"

export type MercadoPagoMethod = "GET" | "POST"

export interface MercadoPagoRequestInit {
  method?: MercadoPagoMethod
  body?: unknown
  /** Lecturas y creaciones: 20 s. Sin llamadas largas: MP responde rápido. */
  timeoutMs?: number
}

export interface MercadoPagoResponse<T = unknown> {
  status: number
  data: T
  durationMs: number
}

export const MERCADOPAGO_TIMEOUT_MS = 20_000

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
 * Única puerta de salida hacia la API de Mercado Pago. El access token del
 * vendedor viaja siempre en el header `Authorization: Bearer` y nunca se
 * registra; los errores se traducen a `MercadoPagoError`.
 */
export async function mercadoPagoRequest<T = unknown>(
  path: string,
  init: MercadoPagoRequestInit = {}
): Promise<MercadoPagoResponse<T>> {
  const { accessToken } = resolveMercadoPagoConfig()
  const url = `${MERCADOPAGO_API_BASE}${path}`

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  }

  let body: string | undefined
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(init.body)
  }

  const timeoutMs = init.timeoutMs ?? MERCADOPAGO_TIMEOUT_MS

  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
  } catch (error) {
    const aborted =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    if (aborted) {
      throw new MercadoPagoError(
        504,
        "timeout",
        `Mercado Pago no respondió en ${Math.round(timeoutMs / 1000)} s.`,
        { details: { path } }
      )
    }
    throw new MercadoPagoError(
      502,
      "network_error",
      "No se pudo conectar con Mercado Pago.",
      {
        details: {
          path,
          cause: error instanceof Error ? error.message : String(error),
        },
      }
    )
  }

  const payload = await readBody(response)
  if (!response.ok) {
    throw toMercadoPagoError(response.status, payload)
  }

  return {
    status: response.status,
    data: payload as T,
    durationMs: 0,
  }
}
