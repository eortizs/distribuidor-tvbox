import { AppError } from "@/server/umejson/types"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

const SYSTEM_PROMPT = [
  "Eres el Asistente del panel de administración Distribuidor TVBox.",
  "Ayudas al usuario con dudas sobre el panel, las entidades umeJSON, análisis y redacción.",
  "Responde siempre en español y usa Markdown para estructurar (encabezados, listas, negritas, tablas y bloques de código).",
  "Aún NO tienes acceso a la base de datos ni a los datos del usuario; cuando lo tengas, solo podrás ver los datos del propio usuario, nunca los de otros usuarios.",
  "Si te preguntan por datos concretos que no puedes ver, dilo con claridad y explica qué podrá hacer cuando el acceso a datos esté habilitado. Nunca inventes datos.",
].join(" ")

const MAX_MESSAGES = 30
const MAX_CONTENT_LENGTH = 4000
const HISTORY_WINDOW = 20

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  if (rateBuckets.size > 1000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key)
    }
  }
  const bucket = rateBuckets.get(userId)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  bucket.count += 1
  return bucket.count <= RATE_LIMIT_MAX
}

export function sanitizeMessages(
  input: unknown
): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    return null
  }
  const messages: ChatMessage[] = []
  for (const item of input) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("role" in item) ||
      !("content" in item)
    ) {
      return null
    }
    const role = (item as { role: unknown }).role
    const content = (item as { content: unknown }).content
    if (role !== "user" && role !== "assistant") return null
    if (typeof content !== "string") return null
    const trimmed = content.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LENGTH) return null
    messages.push({ role, content: trimmed })
  }
  if (messages[messages.length - 1].role !== "user") return null
  return messages.slice(-HISTORY_WINDOW)
}

/*
 * Streams the assistant reply as plain text chunks. The OpenRouter SSE framing
 * stays server-side: the client only ever sees decoded delta text.
 */
export function streamAssistantReply(
  messages: ChatMessage[],
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.ASISTENTE_MODEL
  if (!apiKey || !model) {
    throw new AppError(
      500,
      "llm_not_configured",
      "El asistente no está configurado en el servidor (falta OPENROUTER_API_KEY o ASISTENTE_MODEL)."
    )
  }

  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // A hang upstream must not pin the request forever: abort when no data
      // arrives for a while, while letting slow-but-alive streams finish.
      const upstreamAbort = new AbortController()
      const IDLE_TIMEOUT_MS = 30_000
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      let idleAborted = false
      const clearIdle = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
      }
      const armIdle = () => {
        clearIdle()
        idleTimer = setTimeout(() => {
          idleAborted = true
          upstreamAbort.abort()
        }, IDLE_TIMEOUT_MS)
        idleTimer.unref?.()
      }
      const onClientAbort = () => upstreamAbort.abort()
      if (signal?.aborted) upstreamAbort.abort()
      else signal?.addEventListener("abort", onClientAbort, { once: true })

      let upstream: Response
      try {
        armIdle()
        upstream = await fetch(OPENROUTER_URL, {
          method: "POST",
          signal: upstreamAbort.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          }),
        })
      } catch (error) {
        clearIdle()
        signal?.removeEventListener("abort", onClientAbort)
        if (signal?.aborted) {
          controller.close()
          return
        }
        if (upstreamAbort.signal.aborted) {
          controller.enqueue(
            encoder.encode(
              "El proveedor del modelo tardó demasiado en responder. Inténtalo de nuevo."
            )
          )
          controller.close()
          return
        }
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `asistente: openrouter fetch failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        )
        controller.enqueue(
          encoder.encode(
            "No pude conectarme con el proveedor del modelo. Inténtalo de nuevo en unos momentos."
          )
        )
        controller.close()
        return
      }

      if (!upstream.ok || !upstream.body) {
        clearIdle()
        signal?.removeEventListener("abort", onClientAbort)
        const status = upstream.status
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            error: `asistente: openrouter ${status}`,
          })
        )
        const message =
          status === 401 || status === 403
            ? "El servidor no está autorizado frente al proveedor del modelo (revisa OPENROUTER_API_KEY)."
            : status === 429
              ? "El proveedor del modelo está saturado. Inténtalo de nuevo en unos momentos."
              : "El proveedor del modelo no pudo procesar la solicitud. Inténtalo de nuevo en unos momentos."
        controller.enqueue(encoder.encode(message))
        controller.close()
        return
      }

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          armIdle()
          buffer += decoder.decode(value, { stream: true })

          let newlineIndex = buffer.indexOf("\n")
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim()
            buffer = buffer.slice(newlineIndex + 1)
            newlineIndex = buffer.indexOf("\n")

            // Keep-alive comments (`: OPENROUTER PROCESSING`) carry no data.
            if (line.length === 0 || line.startsWith(":")) continue
            if (!line.startsWith("data:")) continue

            const payload = line.slice("data:".length).trim()
            if (payload === "[DONE]") continue

            try {
              const parsed = JSON.parse(payload) as {
                choices?: { delta?: { content?: string | null } }[]
              }
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) controller.enqueue(encoder.encode(delta))
            } catch {
              // Malformed chunk: skip rather than abort the stream.
            }
          }
        }
      } catch (error) {
        if (!signal?.aborted) {
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              error: `asistente: stream interrupted${idleAborted ? " (idle timeout)" : ""}: ${error instanceof Error ? error.message : String(error)}`,
            })
          )
          controller.enqueue(
            encoder.encode(
              idleAborted
                ? "\n\n_El proveedor del modelo dejó de responder. Vuelve a enviar tu mensaje para reintentar._"
                : "\n\n_La respuesta se interrumpió. Vuelve a enviar tu mensaje para reintentar._"
            )
          )
        }
      } finally {
        clearIdle()
        signal?.removeEventListener("abort", onClientAbort)
        controller.close()
        reader.releaseLock()
      }
    },
  })
}
