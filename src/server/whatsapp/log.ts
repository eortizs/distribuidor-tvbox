import pino from "pino"

/** Logger silencioso de Baileys (una instancia compartida). */
export const logger = pino({ level: "silent" })

export function log(context: string, error?: unknown): void {
  const line = error
    ? `whatsapp: ${context}: ${error instanceof Error ? error.message : String(error)}`
    : `whatsapp: ${context}`
  console.error(JSON.stringify({ ts: new Date().toISOString(), error: line }))
}

export function logInfo(event: string, extra: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }))
}
