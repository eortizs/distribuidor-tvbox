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
import { listClientsInScope } from "./tools"

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

  vence: async ({ user, args }) => {
    // Ventana fija del comando: vencimiento en MENOS de 2 días (0 = vence
    // hoy, 1 = vence mañana), orden ascendente por días. Como toda regla
    // sobre días del panel, solo considera clientes vigentes (nunca
    // vencidos) — el mismo criterio del filtro «Por vencer» de /clientes y
    // de la herramienta proximos_vencimientos. Args ignorados a propósito.
    void args
    let clients: Awaited<ReturnType<typeof listClientsInScope>>["clients"]
    try {
      clients = (await listClientsInScope(user.id)).clients
    } catch {
      return {
        text: "No pude consultar el panel de FlujoTV en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
      }
    }
    if (clients.length === 0) {
      return {
        text: "No encontré clientes FlujoTV en tu alcance.",
      }
    }
    const porVencer = clients
      .filter(
        (c) =>
          c.daysRemaining !== null &&
          c.daysRemaining >= 0 &&
          c.daysRemaining < 2
      )
      .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0))
    if (porVencer.length === 0) {
      return {
        text: "Ningún cliente de tu alcance vence en menos de 2 días.",
      }
    }
    const listing = porVencer
      .map((c) => `${c.userName} (${c.daysRemaining}d)`)
      .join("\n")
    return {
      text: `**Vencen en menos de 2 días (${porVencer.length})**\n\n${listing}`,
    }
  },

  clientes: async ({ user, args }) => {
    // Listado completo del alcance propio, partido por el semáforo de la GUI
    // de /clientes con su MISMA regla de presets: «Activo» es
    // statusLabel === "activo" y «Vencido» todo lo demás (vencidos,
    // pendientes y pruebas — el preset «inactivo» de clientes-accordion).
    // Orden A→Z por usuario dentro de cada grupo, como el listado plano de
    // la GUI. Args ignorados a propósito.
    void args
    let clients: Awaited<ReturnType<typeof listClientsInScope>>["clients"]
    try {
      clients = (await listClientsInScope(user.id)).clients
    } catch {
      return {
        text: "No pude consultar el panel de FlujoTV en este momento. Inténtalo de nuevo en unos minutos; si el problema persiste, avisa al administrador.",
      }
    }
    if (clients.length === 0) {
      return {
        text: "No encontré clientes FlujoTV en tu alcance.",
      }
    }
    const sorted = [...clients].sort((a, b) =>
      a.userName.localeCompare(b.userName, "es")
    )
    const activos = sorted.filter((c) => c.statusLabel === "activo")
    const vencidos = sorted.filter((c) => c.statusLabel !== "activo")
    const section = (label: string, group: typeof sorted) =>
      group.length === 0
        ? null
        : `**${label} (${group.length})**\n\n${group
            .map((c) => c.userName)
            .join("\n")}`
    const parts = [section("Activo", activos), section("Vencido", vencidos)]
      .filter((part): part is string => part !== null)
    return { text: parts.join("\n\n") }
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
