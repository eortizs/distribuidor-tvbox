import { extractMessageContent, downloadMediaMessage, proto, type WAMessage, type WASocket } from "@whiskeysockets/baileys"

import { MAX_ASSISTANT_ATTACHMENT_BYTES } from "@/lib/attachments"

import { logger } from "./log.ts"

/*
 * Helpers PUROS del canal WhatsApp (§4.5 2A del plan): extracción de texto y
 * medios de un mensaje Baileys, sin BD ni estado global. Lo consumen las
 * ramas de entrante del gateway para TODAS las sesiones (legado y negocios).
 */

/** Tope de espera para descifrar y bajar un archivo de WhatsApp. */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000
/** Tipos de archivo que el agente puede interpretar (los mismos del Asistente). */
export const SUPPORTED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]
/** Mensajes offline más viejos que esto no se responden (backfill antiguo). */
export const STALE_MESSAGE_MS = 6 * 60 * 60 * 1000
/** Mensajes guardados para re-encrypt en reintentos (getMessage). */
export const MESSAGE_STORE_MAX = 500

export { logger, log, logInfo } from "./log.ts"

export function extractText(message: object | null | undefined): string {
  if (!message || typeof message !== "object") return ""
  const anyMessage = message as Record<string, unknown>
  const conversation = anyMessage.conversation
  if (typeof conversation === "string" && conversation.trim()) {
    return conversation.trim()
  }
  const extended = anyMessage.extendedTextMessage as
    | Record<string, unknown>
    | undefined
  const text = extended?.text
  if (typeof text === "string" && text.trim()) {
    return text.trim()
  }
  return ""
}

/**
 * Contenido del mensaje ya desenvuelto (WhatsApp envuelve fotos/documents en
 * efímeros, view-once y plantillas): `extractMessageContent` de Baileys deja
 * a la vista `imageMessage` / `documentMessage` del mensaje real.
 */
export function unwrappedContent(
  message: object | null | undefined
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") return null
  const content = extractMessageContent(message as proto.IMessage)
  return content && typeof content === "object"
    ? (content as Record<string, unknown>)
    : null
}

function captionOf(media: unknown): string {
  const caption = (media as Record<string, unknown> | undefined)?.caption
  return typeof caption === "string" ? caption.trim() : ""
}

/** Texto de acompañamiento del archivo (caption de foto o documento). */
export function extractCaption(message: object | null | undefined): string {
  const content = unwrappedContent(message)
  if (!content) return ""
  return captionOf(content.imageMessage) || captionOf(content.documentMessage)
}

/** El archivo (imagen o documento) que trae el mensaje, sin bajar nada. */
export function extractMediaInfo(
  message: object | null | undefined
): { mimeType: string; fileName: string | null } | null {
  const content = unwrappedContent(message)
  if (!content) return null
  const image = content.imageMessage as { mimetype?: unknown } | undefined
  if (image && typeof image.mimetype === "string" && image.mimetype) {
    return { mimeType: image.mimetype, fileName: null }
  }
  const document = content.documentMessage as {
    mimetype?: unknown
    fileName?: unknown
  } | undefined
  if (document && typeof document.mimetype === "string" && document.mimetype) {
    return {
      mimeType: document.mimetype,
      fileName:
        typeof document.fileName === "string" && document.fileName.trim()
          ? document.fileName.trim()
          : null,
    }
  }
  return null
}

/** Nombre de archivo por omisión cuando WhatsApp no manda uno. */
export function defaultMediaFileName(mimeType: string): string {
  if (mimeType === "application/pdf") return "documento.pdf"
  const ext = mimeType.split("/")[1]?.split(";")[0] || "bin"
  return `imagen.${ext}`
}

/**
 * Baja el archivo del mensaje (con re-petición a WhatsApp si el medio ya
 * expiró en el servidor) con tope de tiempo.
 */
export async function downloadIncomingMedia(
  m: WAMessage,
  socket: WASocket
): Promise<Buffer> {
  const download = downloadMediaMessage(m, "buffer", {}, {
    reuploadRequest: socket.updateMediaMessage,
    logger,
  })
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("media_download_timeout")),
      MEDIA_DOWNLOAD_TIMEOUT_MS
    ).unref?.()
  )
  return Promise.race([download, timeout])
}

/** Quita decoraciones de WhatsApp (negritas, emojis de viñeta, espacios). */
export function cleanReplyText(text: string): string {
  return text.replace(/\*/g, "").trim()
}

/** Máximo de bytes de un adjunto entrante (el mismo del Asistente). */
export const MAX_ATTACHMENT_BYTES = MAX_ASSISTANT_ATTACHMENT_BYTES
