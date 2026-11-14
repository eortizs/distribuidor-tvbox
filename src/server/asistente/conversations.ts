import { pool, withTransaction } from "@/server/db"
import { publishRealtime } from "@/server/realtime/bus"
import {
  attachmentContextBlock,
  parseAttachmentMetas,
  type AssistantAttachmentMeta,
} from "./attachments"

/*
 * Conversación unificada del asistente: UNA historia por usuario compartida
 * por la PWA (/soporte/asistente) y el agente de WhatsApp. La fuente de
 * verdad vive en `assistant_messages` (migración
 * db/apply-assistant-conversations.mjs) — el navegador ya no envía su
 * propio historial y la memoria volátil del agente de WhatsApp desaparece:
 * ambos canales leen y escriben aquí, así que lo hablado en un canal
 * continúa en el otro.
 *
 * El contenido se persiste con los valores reales (post-aliasing); el
 * aliasing de correos sigue aplicándose SOLO en la frontera con el LLM.
 * Los adjuntos del turno viven en la columna `attachments` (metadatos + la
 * transcripción de visión ya extraída); a la hora de armar el contexto del
 * LLM se agregan como bloque de datos con `toLlmMessages`, sin tocar el
 * texto visible del turno.
 */

export type AssistantChannel = "web" | "whatsapp"

export interface AssistantMessageRow {
  id: number
  role: "user" | "assistant"
  content: string
  channel: AssistantChannel
  createdAt: string
  attachments: AssistantAttachmentMeta[]
}

/** Turnos que se conservan por usuario: memoria conversacional, no auditoría. */
const RETAIN_PER_USER = 200

export async function loadConversation(
  userId: string,
  limit: number
): Promise<AssistantMessageRow[]> {
  const result = await pool.query<{
    id: string
    role: "user" | "assistant"
    content: string
    channel: AssistantChannel
    created_at: Date
    attachments: unknown
  }>(
    `SELECT id, role, content, channel, created_at, attachments
       FROM assistant_messages
      WHERE user_id = $1::uuid
      ORDER BY id DESC
      LIMIT $2`,
    [userId, limit]
  )
  return result.rows
    .map((row) => ({
      id: Number(row.id),
      role: row.role,
      content: row.content,
      channel: row.channel,
      createdAt: row.created_at.toISOString(),
      attachments: parseAttachmentMetas(row.attachments),
    }))
    .reverse()
}

/**
 * Añade un turno a la conversación del usuario y poda la historia al tope
 * de retención. `skipIfLastUser` evita duplicar el mensaje del usuario en
 * reintentos: si el último turno persistido ya es ese mismo mensaje de
 * usuario (p. ej. el intento anterior falló antes de producir respuesta),
 * no se vuelve a insertar.
 */
export async function appendConversationMessage(params: {
  userId: string
  role: "user" | "assistant"
  content: string
  channel: AssistantChannel
  skipIfLastUser?: boolean
  /** Adjuntos del turno (con sus descripciones ya calculadas). */
  attachments?: AssistantAttachmentMeta[]
}): Promise<void> {
  const content = params.content.trim()
  const attachments = params.attachments ?? []
  // Un turno necesita texto o adjuntos: sin ninguno no hay nada que contar.
  if (content.length === 0 && attachments.length === 0) return

  await withTransaction(async (tx) => {
    if (params.skipIfLastUser) {
      const last = await tx.query(
        `SELECT role, content FROM assistant_messages
          WHERE user_id = $1::uuid
          ORDER BY id DESC LIMIT 1`,
        [params.userId]
      )
      const row = last.rows[0] as
        | { role: string; content: string }
        | undefined
      if (row && row.role === "user" && row.content === content) {
        return
      }
    }
    await tx.query(
      `INSERT INTO assistant_messages (user_id, role, content, channel, attachments)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
      [
        params.userId,
        params.role,
        content,
        params.channel,
        JSON.stringify(attachments),
      ]
    )
    await tx.query(
      `DELETE FROM assistant_messages
        WHERE user_id = $1::uuid
          AND id NOT IN (
            SELECT id FROM assistant_messages
             WHERE user_id = $1::uuid
             ORDER BY id DESC LIMIT $2
           )`,
      [params.userId, RETAIN_PER_USER]
    )
    // Aviso en tiempo real al propio usuario (la otra pestaña/canal refresca
    // la conversación). Dentro de la transacción: si la escritura revierte,
    // el NOTIFY no se entrega.
    await publishRealtime(tx, {
      kind: "assistant",
      distribuidorId: params.userId,
    })
  })
}

/**
 * Historia persistida → mensajes para el LLM: cada turno con adjuntos lleva
 * su bloque de datos (las transcripciones ya guardadas, sin releer archivos)
 * pegado al contenido. Es el único punto donde los adjuntos entran al
 * contexto: la PWA y WhatsApp comparten la misma vista de la conversación.
 */
export function toLlmMessages(
  rows: readonly AssistantMessageRow[]
): { role: "user" | "assistant"; content: string }[] {
  return rows.map((row) => ({
    role: row.role,
    content:
      row.attachments.length > 0
        ? `${row.content}${attachmentContextBlock(row.attachments)}`
        : row.content,
  }))
}
