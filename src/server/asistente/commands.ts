import type { AuthUser } from "@/server/auth/types"
import {
  parseSlashCommand,
  SLASH_COMMAND_NAMES,
  type SlashCommandName,
} from "@/lib/asistente-commands"
import { AppError } from "@/server/umejson/types"
import {
  enqueueWhatsAppForUser,
  getWhatsAppPhoneOf,
} from "@/server/whatsapp/service"

import { appendConversationMessage, loadConversation } from "./conversations"

/*
 * Ejecución de slash commands del Asistente: mecanismo directo, SIN pasar por
 * el LLM (doble vía de atención junto al modelo). La ruta del chat pregunta
 * aquí antes de armar el contexto; un texto sin forma de comando sigue su
 * curso normal.
 *
 * El registro está tipado 1:1 con SLASH_COMMANDS (src/lib/asistente-commands.ts):
 * agregar un comando ahí y no aquí (o viceversa) no compila.
 *
 * Cada comando ejecutado persiste sus dos turnos en la conversación unificada
 * (appendConversationMessage), así el intercambio queda en la historia de la
 * PWA y de WhatsApp como el resto de la charla.
 */

export interface SlashCommandContext {
  user: AuthUser
  /** Texto tras el nombre del comando (ya recortado; vacío si no hubo). */
  args: string
}

interface SlashCommandResult {
  /** Respuesta (Markdown) mostrada como turno del asistente. */
  text: string
}

type SlashCommandHandler = (
  context: SlashCommandContext
) => Promise<SlashCommandResult>

const handlers: Record<SlashCommandName, SlashCommandHandler> = {
  holamundo: async ({ user, args }) => {
    // Comando de prueba del canal WhatsApp: manda la bienvenida al número
    // registrado del propio usuario (decisión de diseño: nunca a números
    // arbitrarios). Args ignorados a propósito.
    void args
    const phone = await getWhatsAppPhoneOf(user.id)
    if (!phone) {
      return {
        text: "No tienes un número de WhatsApp registrado en tu cuenta. Regístralo en **Perfil → WhatsApp** y vuelve a ejecutar `/holamundo` para recibir la bienvenida por ese canal.",
      }
    }
    const enqueued = await enqueueWhatsAppForUser({
      userId: user.id,
      notificationId: null,
      kind: "slash_command",
      title: "Bienvenida del Asistente",
      body: `¡Hola, ${user.username}! Soy el Asistente del panel de distribuidores y este es mi canal de WhatsApp: la misma conversación que ves en el panel continúa aquí. Puedo ayudarte con tus gastos, saldo, clientes FlujoTV, vencimientos, tickets y órdenes.`,
    })
    if (!enqueued) {
      return {
        text: "No pude encolar el mensaje de bienvenida para tu WhatsApp en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
      }
    }
    return {
      text: `**Comando /holamundo ejecutado**\n\nEnvié un mensaje de bienvenida a tu WhatsApp registrado (${phone}). La entrega va por la cola del canal: suele salir en segundos y sobrevive cortes de conexión.`,
    }
  },
}

/**
 * Interpreta `rawMessage` como slash command y lo ejecuta para `user`.
 *
 * - null: el texto no tiene forma de comando → la ruta sigue hacia el LLM.
 * - string: respuesta ya ejecutada (turnos user/assistant persistidos), lista
 *   para devolverse como cuerpo text/plain.
 *
 * Un nombre desconocido lanza 422 `comando_desconocido` (defensa en
 * profundidad: el cliente valida antes de enviar).
 *
 * Reintento seguro: si el último turno persistido es exactamente este comando,
 * NO se vuelve a ejecutar el handler (evita duplicar efectos como el envío de
 * WhatsApp) — se re-emite la respuesta previa, o una nota de "ya ejecutado"
 * si la respuesta anterior no llegó a guardarse.
 */
export async function executeSlashCommand(
  user: AuthUser,
  rawMessage: string
): Promise<string | null> {
  const parsed = parseSlashCommand(rawMessage)
  if (!parsed) return null
  const trimmed = rawMessage.trim()

  const handler = (handlers as Record<string, SlashCommandHandler | undefined>)[
    parsed.name
  ]
  if (!handler) {
    const available = SLASH_COMMAND_NAMES.map((name) => `/${name}`).join(", ")
    throw new AppError(
      422,
      "comando_desconocido",
      `No existe el comando /${parsed.name}. Disponibles: ${available}.`
    )
  }

  // El cliente reenvía con `dedupe: true` al reintentar; la misma huella
  // (último turno de usuario === este comando) marca una re-ejecución.
  const previous = await loadConversation(user.id, 2)
  const lastRow = previous[previous.length - 1]
  if (lastRow && lastRow.role === "user" && lastRow.content === trimmed) {
    const priorAssistant =
      previous.length >= 2 ? previous[previous.length - 2] : undefined
    if (priorAssistant && priorAssistant.role === "assistant") {
      return priorAssistant.content
    }
    const text =
      "El comando ya se había ejecutado, pero su respuesta no llegó a guardarse; no lo volví a correr para no duplicar el efecto. Repítelo si quieres ejecutarlo de nuevo a propósito."
    await appendConversationMessage({
      userId: user.id,
      role: "assistant",
      content: text,
      channel: "web",
    })
    return text
  }

  await appendConversationMessage({
    userId: user.id,
    role: "user",
    content: trimmed,
    channel: "web",
  })
  const result = await handler({ user, args: parsed.args })
  await appendConversationMessage({
    userId: user.id,
    role: "assistant",
    content: result.text,
    channel: "web",
  })
  return result.text
}
