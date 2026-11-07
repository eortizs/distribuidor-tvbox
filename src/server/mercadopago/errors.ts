/**
 * Errores del motor de pagos de Mercado Pago. Mismo contrato que
 * `FlujoApiError`: código HTTP, código operable y detalle para conciliar.
 */
export class MercadoPagoError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown } = {}
  ) {
    super(message)
    this.name = "MercadoPagoError"
    this.status = status
    this.code = code
    if (options.details !== undefined) this.details = options.details
  }
}

/**
 * Traduce una respuesta no exitosa de la API de Mercado Pago a un error
 * operable. La API responde `{ message, error, status }` con códigos HTTP
 * propios; los más frecuentes se mapean a mensajes accionables.
 */export function toMercadoPagoError(
  status: number,
  payload: unknown
): MercadoPagoError {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null
  const detail =
    typeof record?.message === "string" && record.message.trim().length > 0
      ? record.message.trim().slice(0, 400)
      : typeof payload === "string" && payload.trim().length > 0
        ? payload.trim().slice(0, 400)
        : null

  const known: Record<number, { code: string; message: string }> = {
    400: {
      code: "invalid_request",
      message: "Mercado Pago rechazó la solicitud por datos incorrectos.",
    },
    401: {
      code: "unauthorized",
      message:
        "Las credenciales de Mercado Pago son inválidas o expiraron. Revisa MERCADOPAGO_ACCESS_TOKEN en el servidor.",
    },
    403: {
      code: "forbidden",
      message:
        "La aplicación de Mercado Pago no tiene permiso para esta operación.",
    },
    404: {
      code: "not_found",
      message: "El recurso no existe en Mercado Pago.",
    },
    429: {
      code: "rate_limited",
      message: "Se excedió el límite de solicitudes a Mercado Pago.",
    },
  }

  const mapped = known[status]
  if (mapped) {
    return new MercadoPagoError(
      status,
      mapped.code,
      detail ? `${mapped.message} (${detail})` : mapped.message,
      { details: payload }
    )
  }

  if (status >= 500) {
    return new MercadoPagoError(
      status,
      "upstream_error",
      detail
        ? `Mercado Pago falló con ${status}: ${detail}`
        : `Mercado Pago falló con ${status}.`,
      { details: payload }
    )
  }

  return new MercadoPagoError(
    status,
    "unexpected_status",
    detail
      ? `Mercado Pago respondió ${status}: ${detail}`
      : `Mercado Pago respondió ${status}.`,
    { details: payload }
  )
}

/**
 * Traduce un error del motor de pagos al formato de error del panel
 * (`{ ok: false, error: { code, message } }`), igual que el resto de rutas.
 */
export function mpErrorResponse(error: unknown): Response {
  if (error instanceof MercadoPagoError) {
    const status =
      error.status >= 400 && error.status < 600 ? error.status : 502
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status }
    )
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `mercadopago: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
  return Response.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "Error interno al hablar con Mercado Pago.",
      },
    },
    { status: 500 }
  )
}
