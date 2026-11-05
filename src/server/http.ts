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

/**
 * Lee el cuerpo cortando la lectura de verdad al llegar al tope (no confía
 * en Content-Length ni acumula más bytes de la cuenta). Devuelve null si el
 * cuerpo superó el límite.
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const raw = await readBodyWithLimit(request, maxBytes)
  if (raw === null) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: {
            code: "payload_too_large",
            message: `Request body exceeds the ${maxBytes} byte limit`,
          },
        },
        // La lectura se cortó a mitad del cuerpo: la conexión no se reutiliza
        // (el cliente aún podía estar enviando bytes cuando llega el 413).
        { status: 413, headers: { Connection: "close" } }
      ),
    }
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(raw)) as unknown }
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
