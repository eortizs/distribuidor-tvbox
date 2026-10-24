"use client"

import type {
  FlujoClientsResponse,
  FlujoLicensesResponse,
  FlujoRawResult,
  FlujoRenewalResult,
  FlujoStatus,
} from "@/lib/flujotv"

export class FlujoRequestError extends Error {
  code: string
  retryAfter: number | null

  constructor(message: string, code: string, retryAfter: number | null) {
    super(message)
    this.name = "FlujoRequestError"
    this.code = code
    this.retryAfter = retryAfter
  }
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string; retry_after?: number }
}

async function parse<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T>
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new FlujoRequestError(
      "El servidor devolvió una respuesta ilegible.",
      "invalid_response",
      null
    )
  }

  if (!payload.ok || payload.data === undefined) {
    throw new FlujoRequestError(
      payload.error?.message ?? "La solicitud a la API falló.",
      payload.error?.code ?? "unknown_error",
      payload.error?.retry_after ?? null
    )
  }

  return payload.data
}

export async function fetchFlujoStatus(): Promise<FlujoStatus> {
  const response = await fetch("/api/flujotv/status", { cache: "no-store" })
  return parse<FlujoStatus>(response)
}

export async function fetchFlujoClients(params: {
  query?: string
  includeCredentials?: boolean
}): Promise<FlujoClientsResponse> {
  const search = new URLSearchParams()
  if (params.query) search.set("q", params.query)
  if (params.includeCredentials) search.set("include_credentials", "true")
  const suffix = search.toString()
  const response = await fetch(
    `/api/flujotv/clients${suffix ? `?${suffix}` : ""}`,
    { cache: "no-store" }
  )
  return parse<FlujoClientsResponse>(response)
}

export async function fetchFlujoLicenses(): Promise<FlujoLicensesResponse> {
  const response = await fetch("/api/flujotv/licenses", { cache: "no-store" })
  return parse<FlujoLicensesResponse>(response)
}

export async function renewFlujoLicense(params: {
  userName: string
  months: number
  idempotencyKey: string
}): Promise<FlujoRenewalResult> {
  const response = await fetch("/api/flujotv/renewals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      user_name: params.userName,
      months: params.months,
    }),
  })
  return parse<FlujoRenewalResult>(response)
}

export async function refreshFlujo(
  target: "list_clients" | "cache"
): Promise<FlujoRawResult> {
  const response = await fetch("/api/flujotv/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  })
  return parse<FlujoRawResult>(response)
}

export async function sendRawFlujoRequest(params: {
  method: "GET" | "POST"
  path: string
  query: string
  body: string
}): Promise<FlujoRawResult> {
  const response = await fetch("/api/flujotv/raw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return parse<FlujoRawResult>(response)
}
