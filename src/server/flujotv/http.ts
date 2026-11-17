import { FlujoApiError } from "./errors"
import { AppError } from "@/server/umejson/types"

/**
 * Traduce un error de la API FlujoTV al formato de error del panel
 * (`{ ok: false, error: { code, message } }`), igual que el resto de rutas.
 * Los `AppError` del servidor (p. ej. las guardas de compra
 * `assertFlujoPurchaseScope`: 503 `scope_unknown`, 403 `forbidden`) salen
 * con su propio estado y la MISMA forma que produce `errorResponse`.
 */
export function flujoErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status }
    )
  }
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
