import { AppError } from "@/server/umejson/types"

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined
            ? { details: error.details }
            : {}),
        },
      },
      { status: error.status }
    )
  }
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    })
  )
  return Response.json(
    {
      ok: false,
      error: { code: "internal_error", message: "Internal server error" },
    },
    { status: 500 }
  )
}

export const MAX_BODY_BYTES = 100 * 1024

export async function readJsonBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "payload_too_large",
            message: "Request body exceeds the 100 KB limit",
          },
        },
        { status: 413 }
      ),
    }
  }
  try {
    return { ok: true, body: JSON.parse(raw) as unknown }
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: { code: "invalid_json", message: "Body is not valid JSON" },
        },
        { status: 400 }
      ),
    }
  }
}
