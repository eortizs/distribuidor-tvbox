import { FlujoApiError } from "./errors"

/**
 * Traduce un error de la API FlujoTV al formato de error del panel
 * (`{ ok: false, error: { code, message } }`), igual que el resto de rutas.
 */
export function flujoErrorResponse(error: unknown): Response {
  if (error instanceof FlujoApiError) {
    const status =
      error.status >= 400 && error.status < 600 ? error.status : 502
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.retryAfter !== null
            ? { retry_after: error.retryAfter }
            : {}),
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status }
    )
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: `flujotv: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  )
  return Response.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "Error interno al hablar con la API de FlujoTV.",
      },
    },
    { status: 500 }
  )
}
