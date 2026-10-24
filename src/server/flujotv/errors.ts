/**
 * Errores de la API FlujoTV. Cada uno traduce un código HTTP del servicio a un
 * mensaje accionable para el operador, y conserva lo que hace falta para
 * reconciliar (código de error, `Retry-After`, detalle del cuerpo).
 */
export class FlujoApiError extends Error {
  status: number
  code: string
  retryAfter: number | null
  details?: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    options: { retryAfter?: number | null; details?: unknown } = {}
  ) {
    super(message)
    this.name = "FlujoApiError"
    this.status = status
    this.code = code
    this.retryAfter = options.retryAfter ?? null
    if (options.details !== undefined) this.details = options.details
  }
}

const STATUS_MESSAGES: Record<number, { code: string; message: string }> = {
  400: {
    code: "invalid_request",
    message: "La API rechazó la solicitud por parámetros incorrectos.",
  },
  401: {
    code: "unauthorized",
    message:
      "La clave de API es inválida, expiró o fue revocada. Revísala en Configuración → API de licencias o en FLUJO_API_KEY.",
  },
  403: {
    code: "forbidden",
    message: "La clave no tiene el scope necesario para esta operación.",
  },
  404: {
    code: "not_found",
    message: "El recurso solicitado no existe en el panel de FlujoTV.",
  },
  409: {
    code: "idempotency_conflict",
    message:
      "La clave de idempotencia ya se usó con otro payload. Genera una clave nueva para un payload distinto.",
  },
  422: {
    code: "validation_error",
    message: "La API rechazó los datos enviados.",
  },
  429: {
    code: "rate_limited",
    message: "Se excedió el límite de solicitudes de esta clave.",
  },
  503: {
    code: "service_unavailable",
    message:
      "La base de datos de claves no está disponible; la API falla cerrada.",
  },
}

function extractDetail(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim()
    return trimmed.length > 0 && trimmed.length <= 400 ? trimmed : null
  }
  if (typeof payload !== "object" || payload === null) return null
  const record = payload as Record<string, unknown>
  for (const key of ["detail", "message", "error", "reason"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 400)
    }
    if (value && typeof value === "object") {
      const nested = (value as Record<string, unknown>).message
      if (typeof nested === "string" && nested.trim().length > 0) {
        return nested.trim().slice(0, 400)
      }
    }
  }
  return null
}

function isRenewalTimeout(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false
  const record = payload as Record<string, unknown>
  const candidates = [record.code, record.error, record.detail]
  return candidates.some(
    (value) =>
      typeof value === "string" && value.toLowerCase().includes("renewal_timeout")
  )
}

/** Traduce una respuesta no exitosa de la API a un error operable. */
export function toFlujoApiError(
  status: number,
  payload: unknown,
  retryAfter: number | null
): FlujoApiError {
  if (status === 503 && isRenewalTimeout(payload)) {
    return new FlujoApiError(
      status,
      "renewal_timeout",
      "La renovación agotó el tiempo de espera del panel. Reconcilia el estado de la licencia antes de reintentar.",
      { retryAfter, details: payload }
    )
  }

  const known = STATUS_MESSAGES[status]
  const detail = extractDetail(payload)

  if (known) {
    const message = detail ? `${known.message} (${detail})` : known.message
    return new FlujoApiError(status, known.code, message, {
      retryAfter,
      details: payload,
    })
  }

  if (status >= 500) {
    return new FlujoApiError(
      status,
      "upstream_error",
      detail
        ? `La API de FlujoTV falló con ${status}: ${detail}`
        : `La API de FlujoTV falló con ${status}.`,
      { retryAfter, details: payload }
    )
  }

  return new FlujoApiError(
    status,
    "unexpected_status",
    detail
      ? `La API de FlujoTV respondió ${status}: ${detail}`
      : `La API de FlujoTV respondió ${status}.`,
    { retryAfter, details: payload }
  )
}
