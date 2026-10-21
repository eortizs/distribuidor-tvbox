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
