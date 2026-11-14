import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  appendConversationMessage,
  loadConversation,
  toLlmMessages,
} from "@/server/asistente/conversations"
import {
  describeAssistantAttachments,
  resolveAssistantAttachments,
} from "@/server/asistente/attachments"
import {
  checkRateLimit,
  streamAssistantReply,
  sanitizeMessages,
  MAX_CONTENT_LENGTH,
} from "@/server/asistente/llm"
import { errorResponse, readJsonBody } from "@/server/http"
import { AppError } from "@/server/umejson/types"

/*
 * Conversación unificada del asistente: la historia vive en el servidor
 * (assistant_messages) y la comparten la PWA y el agente de WhatsApp.
 *
 * GET  → últimos turnos del usuario (para el render inicial de la PWA,
 *        incluye los turnos originados en WhatsApp y los metadatos de sus
 *        adjuntos).
 * POST { message, attachmentIds? } → contrato nuevo: el servidor carga el
 *        historial, valida y transcribe los adjuntos (visión), añade el
 *        mensaje y persiste la respuesta al terminar el stream. Sin texto y
 *        con adjuntos también es válido: el bloque de datos lleva el
 *        contexto y el asistente responde a lo que muestran los archivos.
 * POST { messages } → contrato legacy (bundle viejo en caché): el cliente
 *        sigue enviando su historial, pero los turnos también se persisten
 *        para que WhatsApp continúe la misma conversación.
 */

const HISTORY_CONTEXT_TURNS = 20
const HISTORY_RENDER_TURNS = 40

interface ChatBody {
  message?: unknown
  messages?: unknown
  dedupe?: unknown
  attachmentIds?: unknown
}

export async function GET() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const rows = await loadConversation(user.id, HISTORY_RENDER_TURNS)
    return Response.json({
      ok: true,
      data: {
        messages: rows.map((row) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          channel: row.channel,
          created_at: row.createdAt,
          attachments: row.attachments.map((attachment) => ({
            id: attachment.fileId,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          })),
        })),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!checkRateLimit(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Has alcanzado el límite de mensajes por minuto. Inténtalo de nuevo en un momento."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = body.body as ChatBody

    // Contrato nuevo: un solo mensaje (con adjuntos opcionales); el
    // historial lo carga el servidor.
    if (typeof parsed.message === "string") {
      const message = parsed.message.trim()
      if (message.length > MAX_CONTENT_LENGTH) {
        throw new AppError(
          422,
          "validation_error",
          "El mensaje debe tener hasta 4000 caracteres."
        )
      }

      // Adjuntos: validar propiedad/límites y transcribirlos con visión
      // ANTES de persistir el turno; la descripción queda en la fila y la
      // historia posterior la reutiliza sin releer archivos.
      const attachmentMetas = await resolveAssistantAttachments(
        user.id,
        parsed.attachmentIds
      )
      if (message.length === 0 && attachmentMetas.length === 0) {
        throw new AppError(
          422,
          "validation_error",
          "Escribe un mensaje o adjunta un archivo."
        )
      }
      const attachments = await describeAssistantAttachments(
        user.id,
        attachmentMetas
      )

      await appendConversationMessage({
        userId: user.id,
        role: "user",
        content: message,
        channel: "web",
        skipIfLastUser: parsed.dedupe === true,
        attachments,
      })
      const rows = await loadConversation(user.id, HISTORY_CONTEXT_TURNS)
      const messages = toLlmMessages(rows)
      if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
        throw new AppError(
          409,
          "conflict",
          "La conversación quedó en un estado inesperado; vuelve a enviar tu mensaje."
        )
      }

      const stream = streamAssistantReply(
        messages,
        user.id,
        request.signal,
        (clientText, aborted) => {
          if (aborted || clientText.trim().length === 0) return
          void appendConversationMessage({
            userId: user.id,
            role: "assistant",
            content: clientText.trim(),
            channel: "web",
          }).catch((error: unknown) => {
            console.error(
              JSON.stringify({
                ts: new Date().toISOString(),
                error: `asistente: persist reply failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              })
            )
          })
        }
      )
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    // Contrato legacy: el cliente envía su historial (bundle en caché de un
    // deploy anterior). Se responde igual que siempre, pero los turnos se
    // persisten en la conversación unificada para que WhatsApp los vea.
    const messages = sanitizeMessages(parsed.messages)
    if (!messages) {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: se esperaba { message } o { messages: [{ role, content }] }."
      )
    }

    const stream = streamAssistantReply(
      messages,
      user.id,
      request.signal,
      (clientText, aborted) => {
        void (async () => {
          const lastUser = messages[messages.length - 1]
          if (lastUser?.role === "user") {
            await appendConversationMessage({
              userId: user.id,
              role: "user",
              content: lastUser.content,
              channel: "web",
              skipIfLastUser: true,
            }).catch(() => undefined)
          }
          if (aborted || clientText.trim().length === 0) return
          await appendConversationMessage({
            userId: user.id,
            role: "assistant",
            content: clientText.trim(),
            channel: "web",
          }).catch(() => undefined)
        })()
      }
    )
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
