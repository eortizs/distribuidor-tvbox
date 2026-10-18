import { AppError } from "@/server/umejson/types"

import { ASSISTANT_TOOLS, executeAssistantTool } from "./tools"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

type AssistantToolCallMessage = {
  role: "assistant"
  content: string | null
  tool_calls: {
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }[]
}

type ToolResultMessage = {
  role: "tool"
  tool_call_id: string
  content: string
}

// Messages sent upstream: the system prompt, the sanitized client history and
// the tool exchange accumulated while resolving data tools.
type UpstreamMessage =
  | { role: "system"; content: string }
  | ChatMessage
  | AssistantToolCallMessage
  | ToolResultMessage

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

const MX_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function mxToday(): string {
  return MX_DAY_FORMATTER.format(new Date())
}

function buildSystemPrompt(): string {
  return [
    "Eres el Asistente del panel de administración Distribuidor TVBox.",
    "Ayudas al usuario con dudas sobre el panel, las entidades umeJSON, análisis y redacción.",
    "Tienes acceso a los gastos del usuario mediante herramientas: registrar_gasto, consultar_gastos y resumen_gastos.",
    "Úsalas SIEMPRE que necesites leer o registrar datos de gastos; nunca inventes cifras ni hagas cálculos de estado de cuenta sin ellas.",
    "resumen_gastos genera el estado de cuenta del periodo: total en MXN, desglose por categoría y por mes, y USD pendiente de conversión.",
    "Los gastos en USD se convierten a MXN con el tipo de cambio Banxico del día del gasto; los resultados de las herramientas ya incluyen esa conversión.",
    "Para registrar un gasto necesitas descripción, monto, moneda y fecha; si falta algún dato, pregunta antes de registrar. Tras registrar, confirma al usuario qué quedó guardado y su equivalente en MXN.",
    `Fecha actual en México: ${mxToday()} (YYYY-MM-DD). Resuelve fechas relativas como \"hoy\", \"este mes\" o \"el mes pasado\" usando esa fecha.`,
    "Las herramientas solo acceden a los gastos del propio usuario, nunca a los de otros usuarios.",
    "Responde siempre en español y usa Markdown para estructurar (encabezados, listas, negritas, tablas y bloques de código).",
    "Si te preguntan por datos que las herramientas no cubren, dilo con claridad. Nunca inventes datos.",
  ].join(" ")
}

const MAX_MESSAGES = 30
const MAX_CONTENT_LENGTH = 4000
const HISTORY_WINDOW = 20

// Tool rounds are bounded: the final upstream call omits the tools so the
// model must settle on a text answer instead of looping forever.
const MAX_UPSTREAM_CALLS = 4

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

interface ToolCallAccumulatorEntry {
  id: string
  name: string
  arguments: string
}

interface UpstreamOutcome {
  finishReason: string | null
  content: string
  toolCalls: ToolCallAccumulatorEntry[]
}

type ToolCallDelta = {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/*
 * Streams the assistant reply as plain text chunks. When the model asks for a
 * data tool, the call executes server-side scoped to the session user, its
 * JSON result is appended to the conversation, and the loop continues; the
 * client only ever sees decoded delta text.
 */
export function streamAssistantReply(
  messages: ChatMessage[],
  userId: string,
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

      const conversation: UpstreamMessage[] = [
        { role: "system", content: buildSystemPrompt() },
        ...messages,
      ]

      const failWith = (message: string) => {
        controller.enqueue(encoder.encode(message))
        controller.close()
      }

      try {
        for (let call = 0; call < MAX_UPSTREAM_CALLS; call++) {
          const includeTools = call < MAX_UPSTREAM_CALLS - 1

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
                messages: conversation,
                ...(includeTools
                  ? { tools: ASSISTANT_TOOLS, tool_choice: "auto" }
                  : {}),
              }),
            })
          } catch (error) {
            if (signal?.aborted) {
              controller.close()
              return
            }
            if (upstreamAbort.signal.aborted) {
              failWith(
                "El proveedor del modelo tardó demasiado en responder. Inténtalo de nuevo."
              )
              return
            }
            console.error(
              JSON.stringify({
                ts: new Date().toISOString(),
                error: `asistente: openrouter fetch failed: ${error instanceof Error ? error.message : String(error)}`,
              })
            )
            failWith(
              "No pude conectarme con el proveedor del modelo. Inténtalo de nuevo en unos momentos."
            )
            return
          }

          if (!upstream.ok || !upstream.body) {
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
            failWith(message)
            return
          }

          const outcome = await readUpstreamOutcome(
            upstream.body,
            controller,
            encoder,
            () => {
              armIdle()
            },
            () => Boolean(signal?.aborted)
          )

          const usableToolCalls =
            includeTools &&
            outcome.finishReason === "tool_calls" &&
            outcome.toolCalls.length > 0

          if (!usableToolCalls) break

          conversation.push({
            role: "assistant",
            content: outcome.content.length > 0 ? outcome.content : null,
            tool_calls: outcome.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: toolCall.arguments,
              },
            })),
          })

          for (const toolCall of outcome.toolCalls) {
            const result = await executeAssistantTool(toolCall, userId)
            conversation.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result,
            })
          }
        }
      } catch (error) {
        if (!signal?.aborted) {
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              error: `asistente: turn failed${idleAborted ? " (idle timeout)" : ""}: ${error instanceof Error ? error.message : String(error)}`,
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
      }
    },
  })
}

/*
 * Consumes one upstream SSE stream: forwards content deltas straight to the
 * client, accumulates tool_call deltas, and reports how the stream finished.
 */
async function readUpstreamOutcome(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  armIdle: () => void,
  clientAborted: () => boolean
): Promise<UpstreamOutcome> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  let finishReason: string | null = null
  const toolCallsByIndex = new Map<number, ToolCallAccumulatorEntry>()

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
            choices?: {
              delta?: {
                content?: string | null
                tool_calls?: ToolCallDelta[]
              }
              finish_reason?: string | null
            }[]
          }
          const choice = parsed.choices?.[0]
          if (choice?.finish_reason) finishReason = choice.finish_reason
          const delta = choice?.delta
          if (delta?.content) {
            content += delta.content
            controller.enqueue(encoder.encode(delta.content))
          }
          for (const toolCall of delta?.tool_calls ?? []) {
            const index = toolCall.index ?? 0
            const entry = toolCallsByIndex.get(index) ?? {
              id: "",
              name: "",
              arguments: "",
            }
            if (toolCall.id) entry.id = toolCall.id
            if (toolCall.function?.name) entry.name = toolCall.function.name
            if (toolCall.function?.arguments) {
              entry.arguments += toolCall.function.arguments
            }
            toolCallsByIndex.set(index, entry)
          }
        } catch {
          // Malformed chunk: skip rather than abort the stream.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const toolCalls = [...toolCallsByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, entry]) => entry)
    .filter((entry) => entry.id !== "" && entry.name !== "")

  if (clientAborted()) {
    return { finishReason: "aborted", content, toolCalls: [] }
  }

  return { finishReason, content, toolCalls }
}
