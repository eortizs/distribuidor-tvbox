/**
 * Lógica pura de la herramienta «Dibujar» sobre imágenes de Galería: la
 * validación del cuerpo de la petición, la construcción del overlay SVG que
 * Sharp compone sobre el original y la derivación del nombre de la copia.
 *
 * El módulo no importa nada del proyecto: es comprobable con Node directo
 * (scripts/test-annotations.mjs) y todas sus salidas se construyen únicamente
 * a partir de números y colores validados, nunca de texto libre del cliente.
 */

/** Trazos como los dibuja el cliente: puntos normalizados 0..1 respecto a la
 * imagen, color HEX opaco y grosor como fracción del ancho de la imagen. */
export interface AnnotationPoint {
  x: number
  y: number
}

export type AnnotationStrokeKind = "path" | "arrow"

export interface AnnotationStroke {
  /** `path` (lápiz a mano alzada, por omisión) o `arrow`. */
  kind: AnnotationStrokeKind
  color: string
  width: number
  /** `path`: uno o más puntos. `arrow`: exactamente dos, [punta, cola] —
   * la punta es el punto al que apunta la flecha (el primer toque). */
  points: AnnotationPoint[]
}

/** Límite de trazos por guardado (la UI muestra un error accionable al tope). */
export const MAX_ANNOTATION_STROKES = 500
/** Límite de puntos totales de la petición. */
export const MAX_ANNOTATION_POINTS = 50_000
/** Grosor máximo aceptado: 5% del ancho de la imagen (nada legible lo pide). */
export const MAX_STROKE_WIDTH_RATIO = 0.05
/** Cuerpo de la petición como mucho 2 MiB (la lectura se corta de verdad). */
export const MAX_ANNOTATION_BODY_BYTES = 2 * 1024 * 1024
/** Longitud máxima del nombre de archivo: la misma de `sanitizeFileName`
 * (src/server/storage/user-files.ts), repetida aquí para poder reservar
 * espacio al truncar sin importar la pila de base de datos. */
export const MAX_ANNOTATION_FILE_NAME = 150

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

/** Solo formatos que conservan su codificación al anotar; los demás se
 * rasterizan a PNG (los incompatibles fallan antes, al decodificar). */
export function annotationOutputMime(
  sourceMimeType: string
): "image/png" | "image/jpeg" | "image/webp" {
  if (sourceMimeType === "image/jpeg" || sourceMimeType === "image/webp") {
    return sourceMimeType
  }
  return "image/png"
}

export function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return "png"
}

export type SanitizeAnnotationsResult =
  | { ok: true; strokes: AnnotationStroke[] }
  | { ok: false }

/**
 * Valida el cuerpo de la petición de anotación. Acepta exactamente
 * `{ strokes: [{ kind?: "path" | "arrow", color: "#rrggbb", width: number, points: [x, y][] }] }`:
 * rechaza JSON con colores no HEX opacos, coordenadas no finitas o fuera de
 * rango, grosores inválidos, trazos vacíos, flechas sin sus dos puntos
 * exactos y cualquier exceso de límites.
 */
export function sanitizeAnnotationInput(input: unknown): SanitizeAnnotationsResult {
  if (typeof input !== "object" || input === null) return { ok: false }
  const { strokes } = input as Record<string, unknown>
  if (!Array.isArray(strokes)) return { ok: false }
  if (strokes.length === 0 || strokes.length > MAX_ANNOTATION_STROKES) {
    return { ok: false }
  }
  const cleaned: AnnotationStroke[] = []
  let totalPoints = 0
  for (const raw of strokes) {
    if (typeof raw !== "object" || raw === null) return { ok: false }
    const { kind, color, width, points } = raw as Record<string, unknown>
    let strokeKind: AnnotationStrokeKind = "path"
    if (kind !== undefined && kind !== null) {
      if (kind !== "path" && kind !== "arrow") return { ok: false }
      strokeKind = kind
    }
    if (typeof color !== "string" || !HEX_COLOR_RE.test(color)) {
      return { ok: false }
    }
    if (
      typeof width !== "number" ||
      !Number.isFinite(width) ||
      width <= 0 ||
      width > MAX_STROKE_WIDTH_RATIO
    ) {
      return { ok: false }
    }
    if (!Array.isArray(points) || points.length === 0) return { ok: false }
    if (strokeKind === "arrow" && points.length !== 2) return { ok: false }
    const parsed: AnnotationPoint[] = []
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2) return { ok: false }
      const [x, y] = point as unknown[]
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        return { ok: false }
      }
      parsed.push({ x, y })
    }
    totalPoints += parsed.length
    if (totalPoints > MAX_ANNOTATION_POINTS) return { ok: false }
    cleaned.push({ kind: strokeKind, color: color.toLowerCase(), width, points: parsed })
  }
  return { ok: true, strokes: cleaned }
}

function svgNumber(value: number): string {
  // Tres decimales alcanzan de sobra a 16k px y evitan números exponenciales.
  return (Math.round(value * 1000) / 1000).toFixed(3)
}

/* ---------------------------------------------------------------------- *
 * Flechas: geometría compartida entre el canvas del editor y el SVG que
 * compone el servidor, para que lo que se ve al dibujar sea lo que queda
 * guardado (mismas proporciones a cualquier resolución).
 * ---------------------------------------------------------------------- */

export interface ArrowGeometry {
  /** Dirección unitaria cola → punta. */
  dirX: number
  dirY: number
  /** Punta y cola en píxeles del lienzo de render. */
  tipX: number
  tipY: number
  tailX: number
  tailY: number
  /** Triángulo de la punta. */
  headLen: number
  headHalf: number
}

/**
 * Geometría de una flecha a la escala de render: trazo y punta triangular.
 * `strokeWidthPx`, `widthPx` y `heightPx` son en píxeles del lienzo donde se
 * dibuja (el canvas del editor o el original en el servidor); los mismos
 * ratios producen la misma flecha a cualquier resolución.
 */
export function arrowGeometry(
  tail: AnnotationPoint,
  tip: AnnotationPoint,
  strokeWidthPx: number,
  widthPx: number,
  heightPx: number
): ArrowGeometry {
  const tipX = tip.x * widthPx
  const tipY = tip.y * heightPx
  const tailX = tail.x * widthPx
  const tailY = tail.y * heightPx
  let dirX = tipX - tailX
  let dirY = tipY - tailY
  const length = Math.hypot(dirX, dirY)
  if (length < 1e-6) {
    // Flecha degenerada (nunca llega del cliente, que exige arrastre):
    // la punta mira hacia arriba para que el triángulo tenga dirección
    // segura.
    dirX = 0
    dirY = -1
  } else {
    dirX /= length
    dirY /= length
  }
  const headLen = Math.max(strokeWidthPx * 3, 6)
  const headHalf = Math.max(strokeWidthPx * 1.8, 4)
  return {
    dirX,
    dirY,
    tipX,
    tipY,
    tailX,
    tailY,
    headLen,
    headHalf,
  }
}

/**
 * Overlay SVG con los trazos, a la resolución del original. Solo recibe
 * dimensiones enteras y trazos ya validados, así que la salida no puede
 * contener nada inyectado por el cliente.
 */
export function buildAnnotationOverlaySvg(
  width: number,
  height: number,
  strokes: readonly AnnotationStroke[]
): string {
  const parts: string[] = []
  for (const stroke of strokes) {
    // Grosor proporcional al ancho real, con un mínimo de 1 px para que las
    // imágenes pequeñas sigan mostrando el trazo.
    const strokeWidth = Math.max(stroke.width * width, 1)
    if (stroke.kind === "arrow") {
      // points = [punta, cola]: la punta es el punto al que apunta la flecha.
      const [tip, tail] = stroke.points
      const g = arrowGeometry(tail, tip, strokeWidth, width, height)
      // Línea de la cola a la punta, con extremos redondeados.
      parts.push(
        `<line x1="${svgNumber(g.tailX)}" y1="${svgNumber(g.tailY)}" x2="${svgNumber(g.tipX)}" y2="${svgNumber(g.tipY)}" stroke="${stroke.color}" stroke-width="${svgNumber(strokeWidth)}" stroke-linecap="round"/>`
      )
      // Punta triangular en la punta (la base retrocede hacia la cola).
      const baseX = g.tipX - g.dirX * g.headLen
      const baseY = g.tipY - g.dirY * g.headLen
      const perpX = -g.dirY
      const perpY = g.dirX
      const points =
        `${svgNumber(g.tipX)},${svgNumber(g.tipY)} ` +
        `${svgNumber(baseX + perpX * g.headHalf)},${svgNumber(baseY + perpY * g.headHalf)} ` +
        `${svgNumber(baseX - perpX * g.headHalf)},${svgNumber(baseY - perpY * g.headHalf)}`
      parts.push(`<polygon points="${points}" fill="${stroke.color}"/>`)
      continue
    }
    if (stroke.points.length === 1) {
      // Un toque es un punto: círculo del mismo diámetro que el trazo.
      const point = stroke.points[0]
      parts.push(
        `<circle cx="${svgNumber(point.x * width)}" cy="${svgNumber(point.y * height)}" r="${svgNumber(strokeWidth / 2)}" fill="${stroke.color}"/>`
      )
      continue
    }
    const d = stroke.points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${svgNumber(point.x * width)} ${svgNumber(point.y * height)}`
      )
      .join("")
    parts.push(
      `<path d="${d}" fill="none" stroke="${stroke.color}" stroke-width="${svgNumber(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" ` +
    `height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">` +
    parts.join("") +
    `</svg>`
  )
}

/**
 * Nombre de la copia: `nombre (copia).ext`. Si el nombre no cabe en el límite
 * del sanitizador, se recorta la base conservando el sufijo y la extensión
 * (igual que `sanitizeFileName`, que se queda con el final del nombre).
 */
export function copyFileName(sourceName: string, extension: string): string {
  const suffix = " (copia)"
  const ext = /^\.[^.]{1,9}$/.test(extension) ? extension : `.${extension}`
  const dot = sourceName.lastIndexOf(".")
  // Un punto inicial es un nombre de punto (sin base real): cae a «imagen».
  const rawBase = dot > 0 ? sourceName.slice(0, dot) : dot === -1 ? sourceName : ""
  const base = rawBase.trim() || "imagen"
  const keep = Math.max(MAX_ANNOTATION_FILE_NAME - suffix.length - ext.length, 1)
  const chars = Array.from(base)
  const trimmed = chars.length > keep ? chars.slice(chars.length - keep).join("") : base
  return `${trimmed}${suffix}${ext}`
}
