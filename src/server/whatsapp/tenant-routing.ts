/*
 * Reglas PURAS de enrutamiento del canal WhatsApp por tenant (§4.5 2B del
 * plan). Las consumen el gateway (entrante), el service (espejo) y el
 * outbox (despacho); las pruebas de Node las cargan directo.
 */

/** Ramas del entrante de un negocio con usuario registrado. */
export type BusinessUserRoute =
  | "payment_order_text"
  | "silent"

/**
 * Usuario DEL tenant escribiendo al número del negocio: SOLO la intercepción
 * de «Solicito un link de pago…» (texto). Adjuntos, en silencio — el número
 * del negocio no es un asistente (sin LLM, sin cortesía).
 */
export function routeBusinessUserTurn(input: {
  hasMedia: boolean
  hasText: boolean
}): BusinessUserRoute {
  if (!input.hasMedia && input.hasText) return "payment_order_text"
  return "silent"
}

/** Ramas del entrante de un negocio con número NO registrado. */
export type BusinessUnknownRoute =
  | "payment_order"
  | "silent"

/**
 * Número ajeno al panel: flujo de pagadores completo (texto y comprobante);
 * sin orden → SILENCIO (sin cortesía de «no registrado»: es el número del
 * negocio).
 */
export function routeBusinessUnknownTurn(input: {
  paymentOrderHandled: boolean
}): BusinessUnknownRoute {
  return input.paymentOrderHandled ? "payment_order" : "silent"
}

/**
 * AUTO-CHAT (§4.5 2B): el WhatsApp registrado de un usuario que ES el número
 * de su tenant no recibe espejo — el socket no puede entregarse un mensaje a
 * sí mismo. Comparación en canónico (el registro y el número declarado ya
 * viven canónicos; la igualdad directa cubre el resto).
 */
export function shouldMirrorToUser(input: {
  userPhone: string
  tenantNumber: string | null
}): boolean {
  if (!input.tenantNumber) return true
  return input.userPhone !== input.tenantNumber
}

/** El dispatcher SOLO reclama con la sesión del tenant ABIERTA. */
export function shouldDispatchTenant(sessionStatus: string | null): boolean {
  return sessionStatus === "open"
}
