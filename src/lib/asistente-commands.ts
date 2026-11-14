/*
 * Slash commands del Asistente (/soporte/asistente): metadatos compartidos
 * entre el cliente (autocompletado y validación) y el servidor (registro de
 * handlers en src/server/asistente/commands.ts). Fuente única: agregar aquí
 * un comando hace que el autocompletado lo ofrezca; el registro de handlers
 * está tipado 1:1 contra esta lista, así que sin su handler no compila.
 *
 * Los comandos se ejecutan en el servidor SIN pasar por el LLM (doble
 * mecanismo de atención). Solo aplican al chat web del panel.
 */

export interface SlashCommandMeta {
  /** Nombre sin la barra inicial (p. ej. "holamundo" para /holamundo). */
  name: string
  /** Descripción corta para el popup de autocompletado. */
  description: string
}

export const SLASH_COMMANDS: readonly SlashCommandMeta[] = [
  {
    name: "holamundo",
    description: "Envía un mensaje de bienvenida a tu WhatsApp registrado.",
  },
] as const

/** Clave tipada del registro de handlers (1:1 con SLASH_COMMANDS). */
export type SlashCommandName = (typeof SLASH_COMMANDS)[number]["name"]

/** Nombres en minúsculas, para validar en el cliente sin importar el servidor. */
export const SLASH_COMMAND_NAMES: readonly string[] = SLASH_COMMANDS.map(
  (command) => command.name
)

export interface ParsedSlashCommand {
  /** Nombre en minúsculas, sin la barra. */
  name: string
  /** Resto del texto tras el nombre (ya recortado); vacío si no hay. */
  args: string
}

/** Fuente única del charset de un nombre de comando: patrón y shape derivan de aquí. */
const SLASH_NAME_SOURCE = "[a-z0-9][a-z0-9-]*"

const SLASH_COMMAND_PATTERN = new RegExp(
  `^\\/(${SLASH_NAME_SOURCE})(?:\\s+([\\s\\S]*))?$`,
  "i"
)

const SLASH_NAME_SHAPE = new RegExp(`^${SLASH_NAME_SOURCE}$`, "i")

/** true si `name` (sin la barra) tiene forma de nombre de comando. */
export function isValidSlashCommandName(name: string): boolean {
  return SLASH_NAME_SHAPE.test(name)
}

/**
 * Detecta un intento de comando al inicio del texto («/holamundo», con args
 * opcionales). Devuelve null si el texto no tiene forma de comando (incluido
 * "/" solo): el mensaje sigue su curso normal hacia el modelo.
 */
export function parseSlashCommand(raw: string): ParsedSlashCommand | null {
  const match = SLASH_COMMAND_PATTERN.exec(raw.trim())
  if (!match) return null
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() }
}

/**
 * Validación del envío en el cliente: devuelve el mensaje de error para un
 * draft con forma de comando, o null si puede enviarse tal cual (incluido
 * texto normal, que aquí no empieza con "/").
 */
export function slashCommandValidationMessage(
  question: string,
  hasAttachments: boolean
): string | null {
  if (!question.startsWith("/")) return null
  const parsed = parseSlashCommand(question)
  // Sin forma de comando (p. ej. una ruta pegada): es texto normal y sigue
  // su curso hacia el modelo, igual que hace el servidor.
  if (!parsed) return null
  if (!SLASH_COMMAND_NAMES.includes(parsed.name)) {
    const available = SLASH_COMMAND_NAMES.map((name) => `/${name}`).join(", ")
    return `No existe el comando /${parsed.name}. Disponibles: ${available}.`
  }
  if (hasAttachments) {
    return "Los comandos no admiten adjuntos: quítalos o envía el comando solo."
  }
  return null
}
