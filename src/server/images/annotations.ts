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

export type AnnotationStrokeKind = "path" | "arrow" | "numero"

export interface AnnotationStroke {
  /** `path` (lápiz a mano alzada, por omisión), `arrow` o `numero`. */
  kind: AnnotationStrokeKind
  color: string
  /** Grosor como fracción del ancho de la imagen; en `numero` es el
   * diámetro del sticker. */
  width: number
  /** `path`: uno o más puntos. `arrow`: exactamente dos, [punta, cola] —
   * la punta es el punto al que apunta la flecha (el primer toque).
   * `numero`: exactamente uno, el centro del sticker. */
  points: AnnotationPoint[]
  /** Solo `numero`: el número impreso (secuencia desde 1). */
  label?: number
}

/** Límite de trazos por guardado (la UI muestra un error accionable al tope). */
export const MAX_ANNOTATION_STROKES = 500
/** Límite de puntos totales de la petición. */
export const MAX_ANNOTATION_POINTS = 50_000
/** Grosor máximo aceptado: 5% del ancho de la imagen (nada legible lo pide). */
export const MAX_STROKE_WIDTH_RATIO = 0.05
/** Diámetro máximo del sticker numerado: 12% del ancho de la imagen. */
export const MAX_NUMBER_SIZE_RATIO = 0.12
/** Número más alto imprimible en un sticker. */
export const MAX_NUMBER_LABEL = 9999
/** Opacidad del sticker numerado: 50 %, aplicada por elemento (círculo y
 * número), con el mismo orden secuencial que replica el canvas del editor
 * para que el preview sea idéntico a la copia guardada. */
export const NUMBER_STICKER_OPACITY = 0.5
/** Familia tipográfica compartida por el canvas del editor y el SVG del
 * servidor: sans bold, con sustitutos presentes en Linux (server). */
export const NUMBER_FONT_STACK =
  "Arial, Helvetica, 'Liberation Sans', 'DejaVu Sans', sans-serif"
/** Centro visual del dígito: la mitad de la altura capital (~0.7 em),
 * compartido por canvas y SVG para que el número quede centrado igual en
 * ambos. */
export const NUMBER_TEXT_BASELINE_RATIO = 0.35
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
 * `{ strokes: [{ kind?: "path" | "arrow" | "numero", color: "#rrggbb", width: number, points: [x, y][], label?: number }] }`:
 * rechaza JSON con colores no HEX opacos, coordenadas no finitas o fuera de
 * rango, grosores inválidos, trazos vacíos, flechas sin sus dos puntos
 * exactos, stickers sin su único punto o su etiqueta, y cualquier exceso de
 * límites.
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
    const { kind, color, width, points, label } = raw as Record<string, unknown>
    let strokeKind: AnnotationStrokeKind = "path"
    if (kind !== undefined && kind !== null) {
      if (kind !== "path" && kind !== "arrow" && kind !== "numero") return { ok: false }
      strokeKind = kind
    }
    if (typeof color !== "string" || !HEX_COLOR_RE.test(color)) {
      return { ok: false }
    }
    // En `numero` el grosor es el diámetro del sticker: tope propio.
    const maxWidth =
      strokeKind === "numero" ? MAX_NUMBER_SIZE_RATIO : MAX_STROKE_WIDTH_RATIO
    if (
      typeof width !== "number" ||
      !Number.isFinite(width) ||
      width <= 0 ||
      width > maxWidth
    ) {
      return { ok: false }
    }
    if (!Array.isArray(points) || points.length === 0) return { ok: false }
    if (strokeKind === "arrow" && points.length !== 2) return { ok: false }
    if (strokeKind === "numero") {
      if (points.length !== 1) return { ok: false }
      if (
        typeof label !== "number" ||
        !Number.isInteger(label) ||
        label < 1 ||
        label > MAX_NUMBER_LABEL
      ) {
        return { ok: false }
      }
    }
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
    // La salida se construye explícitamente: `label` solo viaja en `numero`.
    const labelForStroke =
      strokeKind === "numero" && typeof label === "number" ? label : undefined
    const cleanedStroke: AnnotationStroke = {
      kind: strokeKind,
      color: color.toLowerCase(),
      width,
      points: parsed,
    }
    if (labelForStroke !== undefined) cleanedStroke.label = labelForStroke
    cleaned.push(cleanedStroke)
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

/* ---------------------------------------------------------------------- *
 * Stickers numerados: decisión de contraste y tamaño de letra compartidos
 * entre el canvas del editor y el SVG del servidor, para que lo que se ve
 * al colocar el sticker sea lo que queda guardado.
 * ---------------------------------------------------------------------- */

/**
 * Color de texto que contrasta con el fondo `hex` (#rrggbb): negro sobre
 * fondos claros, blanco sobre oscuros, por brillo percibido (ITU-R 601).
 * El fondo del sticker siempre es el color elegido por la persona.
 */
export function contrastingTextColor(hex: string): "#000000" | "#ffffff" {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return brightness > 0.5 ? "#000000" : "#ffffff"
}

/**
 * Tamaño de letra del número dentro del sticker: escala con el diámetro y
 * se reduce por dígitos para que hasta 4 quepan holgados.
 */
export function numberStickerFontSize(diameterPx: number, label: number): number {
  const digits = String(label).length
  return diameterPx * 0.45 * Math.min(1, 2 / digits)
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
    if (stroke.kind === "numero") {
      // Sticker: círculo del color elegido con el número contrastante
      // centrado, cada elemento al 50 % de opacidad. El orden secuencial
      // (círculo sobre la imagen, número sobre el círculo) replica el que
      // usa el canvas del editor, así que el preview es la copia guardada.
      const [center] = stroke.points
      const label = stroke.label ?? 1
      const diameter = strokeWidth
      const cx = center.x * width
      const cy = center.y * height
      const fontSize = numberStickerFontSize(diameter, label)
      const textColor = contrastingTextColor(stroke.color)
      parts.push(
        `<circle cx="${svgNumber(cx)}" cy="${svgNumber(cy)}" r="${svgNumber(diameter / 2)}" fill="${stroke.color}" fill-opacity="${NUMBER_STICKER_OPACITY}"/>` +
          `<text x="${svgNumber(cx)}" y="${svgNumber(cy + fontSize * NUMBER_TEXT_BASELINE_RATIO)}" font-family="${NUMBER_FONT_STACK}" font-size="${svgNumber(fontSize)}" font-weight="bold" text-anchor="middle" fill="${textColor}" fill-opacity="${NUMBER_STICKER_OPACITY}">${label}</text>`
      )
      continue
    }
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
