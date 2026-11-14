/**
 * Configuración del módulo WhatsApp (Baileys), patrón config por dominio del
 * repo (`mercadopago/config.ts`, `push/service.ts`): variables de entorno con
 * guardas. Sin `WHATSAPP_AGENT_NUMBER` el módulo queda deshabilitado: el
 * gateway no arranca, no se encola nada en `wa_outbox` y las APIs responden
 * `whatsapp_not_configured` — el resto de la app no nota la diferencia.
 *
 * - `WHATSAPP_AGENT_NUMBER`: número del agente IA, solo dígitos con código
 *   de país (525540049353). Es la cuenta de WhatsApp que se vincula como
 *   dispositivo con Baileys y con la que hablan distribuidores y admin.
 * - `WHATSAPP_AGENT_MODEL`: modelo del agente de consultas vía AI Gateway
 *   (AI_GATEWAY_API_KEY), mismo transporte del análisis de tickets.
 */

/**
 * Con código de país obligatorio: los JIDs entrantes siempre lo traen y el
 * lookup compara dígitos exactos — un número de 10 dígitos sin país se
 * registraría pero jamás matchearía un mensaje ni un envío.
 */
const MIN_PHONE_DIGITS = 11
const MAX_PHONE_DIGITS = 15

/** Quita todo lo que no sea dígito (admite +52 55 4004 9353, guiones, etc). */
export function normalizeWhatsAppDigits(raw: string): string {
  return raw.replace(/\D+/g, "")
}

export function isValidWhatsAppNumber(digits: string): boolean {
  return (
    digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS
  )
}

/**
 * Forma canónica de un número para registro y lookup: los móviles de México
 * circulan en WhatsApp en DOS formas — `52` + 10 dígitos (525577977359) y la
 * legacy `52` + `1` + 10 (5215577977359). El envío resuelve con onWhatsApp
 * (tolerante), pero el lookup entrante compara dígitos exactos: sin
 * canonicar, un registro en una forma no matchea el JID que llega en la otra.
 * Canónico: quitar el `1` tras `52` en números de 13 dígitos.
 */
export function canonicalWhatsAppDigits(digits: string): string {
  if (digits.length === 13 && digits.startsWith("521")) {
    return `52${digits.slice(3)}`
  }
  return digits
}

function agentNumberOrNull(): string | null {
  const digits = normalizeWhatsAppDigits(
    process.env.WHATSAPP_AGENT_NUMBER?.trim() ?? ""
  )
  return isValidWhatsAppNumber(digits) ? digits : null
}

/** Número del agente en dígitos; null si no está configurado. */
export function whatsappAgentNumber(): string | null {
  return agentNumberOrNull()
}

/** Modelo del agente de consultas (AI Gateway); null si no está configurado. */
export function whatsappAgentModel(): string | null {
  return process.env.WHATSAPP_AGENT_MODEL?.trim() || null
}

/** El agente conversacional necesita modelo + API key del gateway. */
export function whatsappAgentLlmConfigured(): boolean {
  return (
    whatsappAgentModel() !== null &&
    !!process.env.AI_GATEWAY_API_KEY?.trim()
  )
}
