/**
 * Límites de los adjuntos de las herramientas. Se comparten entre cliente y
 * servidor para que la UI nunca acepte más de lo que el backend valida.
 */

/** Imágenes de referencia por generación (herramienta de imágenes). */
export const MAX_REFERENCE_FILES = 4
/** Tope por imagen de referencia (10 MB). */
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
/** Tope de bytes totales de las imágenes de referencia de una generación. */
export const MAX_REFERENCE_TOTAL_BYTES = 20 * 1024 * 1024
/** Formatos raster aceptados como imagen de referencia. */
export const REFERENCE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const

/** Archivos adjuntos por turno del agente de animación. */
export const MAX_AGENT_ATTACHMENT_FILES = 6
/** Tope por archivo adjunto del agente. */
export const MAX_AGENT_ATTACHMENT_BYTES = 10 * 1024 * 1024
/**
 * Tope de bytes totales de los adjuntos de un turno. Los adjuntos viajan como
 * data URL (base64, ~1.37×) dentro del JSON del POST a `/eve/v1`, y Next.js
 * proxya ese body con `experimental.proxyClientMaxBodySize`: el turno completo
 * tiene que quedar por debajo de ese tope o la petición se trunca.
 */
export const MAX_AGENT_ATTACHMENT_TOTAL_BYTES = 15 * 1024 * 1024

/**
 * Adjuntos de referencia de una alerta (módulo Alertas): el LLM los lee como
 * contexto en cada revisión. Imágenes que Gemini acepta como entrada visual
 * más PDF, formato documental que el mismo modelo lee nativamente.
 */
export const MAX_ALERT_ATTACHMENT_FILES = 4
/** Tope por archivo adjunto de una alerta (10 MB, igual que imágenes). */
export const MAX_ALERT_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Tope de bytes totales de los adjuntos de una alerta. */
export const MAX_ALERT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024
/** Formatos aceptados como adjunto de referencia de una alerta. */
export const ALERT_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const

/** Archivos adjuntos por turno del Asistente (conversación unificada). */
export const MAX_ASSISTANT_ATTACHMENT_FILES = 4
/** Tope por archivo adjunto del Asistente (10 MB, igual que imágenes). */
export const MAX_ASSISTANT_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Tope de bytes totales de los adjuntos de un turno del Asistente. */
export const MAX_ASSISTANT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024
/** Formatos aceptados como adjunto del Asistente (imágenes + PDF). */
export const ASSISTANT_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const
