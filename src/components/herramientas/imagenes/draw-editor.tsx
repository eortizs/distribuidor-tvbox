"use client"

import * as React from "react"
import {
  ArrowUpRightIcon,
  CheckIcon,
  ListOrderedIcon,
  Maximize2Icon,
  PencilIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import {
  arrowGeometry,
  contrastingTextColor,
  MAX_ANNOTATION_POINTS,
  NUMBER_FONT_STACK,
  NUMBER_STICKER_OPACITY,
  NUMBER_TEXT_BASELINE_RATIO,
  numberStickerFontSize,
  type AnnotationStrokeKind,
} from "@/server/images/annotations"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerPanel,
  ColorPickerSlider,
  ColorPickerSwatch,
  ColorPickerSwatches,
  ColorPickerTrigger,
  type ColorPickerI18nOverrides,
} from "@/components/reui/color-picker"

/**
 * Editor de dibujo a pantalla completa para una imagen de Galería, con tres
 * herramientas: lápiz a mano alzada, flechas (se toca el punto al que la
 * flecha debe apuntar y se arrastra hasta la cola) y stickers numerados (un
 * toque coloca el siguiente número en secuencia, dentro de un sticker
 * semitransparente del color elegido y con la letra contrastante). La
 * imagen admite zoom con pellizco (dos dedos) y con rueda/trackpad: un dedo
 * dibuja y dos hacen zoom/paneo, sin que los trazos se desplacen porque
 * todos se guardan normalizados (0..1) respecto a la imagen, así que rotar
 * o cambiar el tamaño no los desplaza, y el servidor compone el mismo
 * dibujo sobre el original a su resolución al aceptar (el original nunca se
 * modifica). La geometría de la flecha y el sticker son las mismas que
 * rasteriza el servidor.
 */

interface DrawStroke {
  /** `path` (lápiz), `arrow` (flecha) o `numero` (sticker numerado). */
  kind: AnnotationStrokeKind
  color: string
  /** Grosor como fracción del ancho de la imagen; en `numero` es el
   * diámetro del sticker. */
  width: number
  /** `path`: puntos del gesto. `arrow`: [punta, cola] — la punta es donde
   * se tocó primero (el punto al que apunta la flecha). `numero`: un solo
   * punto, el centro del sticker. */
  points: [number, number][]
  /** Solo `numero`: el número impreso (secuencia desde 1). */
  label?: number
}

type DrawMode = "lapiz" | "flecha" | "numeros"

/** Arrastre mínimo para que una flecha cuente: un tap sin arrastre no crea
 * nada (evita flechas invisibles por toques accidentales). */
const MIN_ARROW_DRAG_PX = 8

/** Diámetro del sticker numerado: 7% del ancho de la imagen, legible en
 * pantalla y en la copia guardada a resolución completa. Fijo a propósito:
 * sin controles. */
const NUMBER_STICKER_SIZE_RATIO = 0.07

/** Zoom por pellizco: del ajuste inicial (1×) a 4× como máximo (más cerca
 * solo muestra píxeles borrosos de la variante baja). */
const MIN_ZOOM = 1
const MAX_ZOOM = 4
/** Sensibilidad del zoom con rueda/trackpad (delta Y normalizado a px). */
const WHEEL_ZOOM_SENSITIVITY = 0.002

interface DrawImageVariant {
  url: string
}

/** Variante tal como la serializa el servidor para la galería. */
interface DrawSavedVariant {
  variant: "low" | "thumb"
  url: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
  width: number | null
  height: number | null
}

export interface DrawEditorImage {
  id: string
  prompt: string
  file: {
    id: string
    fileName: string
    mimeType: string
    sizeBytes: number
    url: string
    variants?: {
      low?: DrawImageVariant
      thumb?: DrawImageVariant
    }
  }
}

export interface DrawEditorSavedImage {
  id: string
  prompt: string
  model: string
  aspectRatio: string | null
  quality: string | null
  costUsd: number | null
  costMxn: number | null
  createdAt: string
  file: {
    id: string
    fileName: string
    mimeType: string
    sizeBytes: number
    url: string
    variants: {
      low: DrawSavedVariant
      thumb: DrawSavedVariant
    }
  }
}

type DrawEditorProps = {
  /** La generación abierta en el visor, con su archivo. */
  image: DrawEditorImage
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Recibió 201: la copia ya existe y llega serializada. */
  onSaved: (image: DrawEditorSavedImage) => void
}

/** Grosor del lápiz: 1% del ancho de la imagen, legible en pantalla y en la
 * copia guardada a resolución completa. Fijo a propósito: sin controles. */
const STROKE_WIDTH_RATIO = 0.01

/** Preset contrastante para señalar sobre cualquier fondo (incluye
 * negro/blanco). Son contenido del dibujo, no tokens de estado de la UI. */
const STROKE_COLORS: { value: string; label: string }[] = [
  { value: "#ef4444", label: "Rojo" },
  { value: "#facc15", label: "Amarillo" },
  { value: "#22c55e", label: "Verde" },
  { value: "#3b82f6", label: "Azul" },
  { value: "#000000", label: "Negro" },
  { value: "#ffffff", label: "Blanco" },
]

const PICKER_I18N: ColorPickerI18nOverrides = {
  labels: {
    panelLabel: "Color del trazo",
    area: "Color",
    hue: "Tono",
    saturation: "Saturación",
    brightness: "Brillo",
    lightness: "Luminosidad",
    chroma: "Croma",
    red: "Rojo",
    green: "Verde",
    blue: "Azul",
    alpha: "Opacidad",
    hex: "Hex",
    format: "Formato de color",
    eyeDropper: "Tomar un color de la pantalla",
    copy: "Copiar",
    copied: "Copiado",
    clear: "Quitar",
    swatches: "Muestras",
  },
}

type BoxSize = { width: number; height: number }

export function DrawEditor({ image, open, onOpenChange, onSaved }: DrawEditorProps) {
  const [color, setColor] = React.useState(STROKE_COLORS[0].value)
  // Herramienta activa: lápiz libre, flecha o sticker numerado. El ref
  // acompaña al estado para que los manejadores del canvas (eventos) lean
  // siempre la herramienta vigente sin depender del ciclo de render.
  const [mode, setModeState] = React.useState<DrawMode>("lapiz")
  const modeRef = React.useRef<DrawMode>("lapiz")
  const setMode = React.useCallback((next: DrawMode) => {
    modeRef.current = next
    setModeState(next)
  }, [])
  const [strokes, setStrokes] = React.useState<DrawStroke[]>([])
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading")
  const [saving, setSaving] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const [box, setBox] = React.useState<BoxSize | null>(null)

  // Espejo mutable del estado: los movimientos del puntero no deben provocar
  // un render de React por frame; el canvas se pinta de forma incremental.
  const strokesRef = React.useRef<DrawStroke[]>([])
  const totalPointsRef = React.useRef(0)
  const activePointerRef = React.useRef<number | null>(null)
  const currentStrokeRef = React.useRef<DrawStroke | null>(null)
  const boxRef = React.useRef<BoxSize | null>(null)
  const limitToastShownRef = React.useRef(false)
  const areaRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  // Zoom por pellizco: el transform se aplica al contenedor de la imagen de
  // forma imperativa (sin render por frame) y solo se sincroniza al estado
  // para el indicador, al terminar el gesto. Los puntos de los trazos son
  // normalizados, así que el zoom no los desplaza: el canvas transformado
  // sigue reportando coordenadas 0..1 correctas.
  const [zoomLabel, setZoomLabel] = React.useState(1)
  const transformRef = React.useRef({ zoom: 1, x: 0, y: 0 })
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  /** Dedos activos sobre la imagen, para distinguir dibujo (1) de pellizco (2). */
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>())
  /** Pellido en curso: distancia y punto medio iniciales + transform previo. */
  const pinchRef = React.useRef<{
    startDist: number
    startMidX: number
    startMidY: number
    startZoom: number
    startX: number
    startY: number
  } | null>(null)
  /** Toque pendiente del modo Números: se confirma al soltar, para que un
   * pellizco que empieza a mitad no deje un sticker accidental. */
  const pendingNumeroRef = React.useRef<[number, number] | null>(null)

  /** Escribe el transform vigente en el contenedor (translate + scale). */
  const applyTransform = React.useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const { zoom, x, y } = transformRef.current
    wrapper.style.transform =
      zoom === 1 && x === 0 && y === 0
        ? ""
        : `translate(${x}px, ${y}px) scale(${zoom})`
  }, [])

  /** Acota el transform: zoom dentro de límites y paneo sin separar la
   * imagen del área visible (borde jamás entra al lienzo). */
  const clampTransform = React.useCallback(() => {
    const area = areaRef.current
    const box = boxRef.current
    if (!area || !box) return
    const state = transformRef.current
    const rect = area.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    const zoom = Math.min(Math.max(state.zoom, MIN_ZOOM), MAX_ZOOM)
    const maxX = Math.max(0, (box.width * zoom - rect.width) / 2)
    const maxY = Math.max(0, (box.height * zoom - rect.height) / 2)
    state.zoom = zoom
    state.x = Math.min(Math.max(state.x, -maxX), maxX)
    state.y = Math.min(Math.max(state.y, -maxY), maxY)
  }, [])

  /** Vuelve al ajuste inicial (1×, centrado). */
  const resetZoom = React.useCallback(() => {
    transformRef.current = { zoom: 1, x: 0, y: 0 }
    applyTransform()
    setZoomLabel(1)
  }, [applyTransform])

  /** Zoom anclado a un punto de la pantalla (cursor o pellizco): el punto
   * bajo el ancla no se mueve. */
  const zoomAt = React.useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const area = areaRef.current
      if (!area) return
      const rect = area.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const state = transformRef.current
      const nextZoom = Math.min(Math.max(state.zoom * factor, MIN_ZOOM), MAX_ZOOM)
      const ratio = nextZoom / state.zoom
      // Con origen de transform en el centro del área: s = t + z·p.
      const sx = clientX - (rect.left + rect.width / 2)
      const sy = clientY - (rect.top + rect.height / 2)
      state.x = sx - ratio * (sx - state.x)
      state.y = sy - ratio * (sy - state.y)
      state.zoom = nextZoom
      clampTransform()
      applyTransform()
      // La etiqueta de zoom se sincroniza solo si cambia el porcentaje
      // mostrado: la rueda dispara decenas de eventos por segundo y cada
      // estado ocioso sería un re-render del diálogo completo.
      const zoom = transformRef.current.zoom
      setZoomLabel((prev) =>
        Math.round(prev * 100) === Math.round(zoom * 100) ? prev : zoom
      )
    },
    [applyTransform, clampTransform]
  )

  const lowSource = image.file.variants?.low?.url ?? image.file.url

  /** Repinta todos los trazos (y el que esté en curso) sobre el canvas ya
   * dimensionado. */
  const redraw = React.useCallback(() => {
    const canvas = canvasRef.current
    const current = boxRef.current
    if (!canvas || !current) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.clearRect(0, 0, current.width, current.height)
    // Un redimensionado a mitad de gesto no borra el trazo que se está
    // dibujando: se repinta junto a los ya confirmados.
    const all =
      currentStrokeRef.current !== null
        ? [...strokesRef.current, currentStrokeRef.current]
        : strokesRef.current
    for (const stroke of all) {
      ctx.fillStyle = stroke.color
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = Math.max(stroke.width * current.width, 1)
      if (stroke.kind === "numero") {
        // El mismo sticker que rasteriza el servidor: círculo del color
        // elegido con el número contrastante centrado, todo al 50 %.
        const [nx, ny] = stroke.points[0]
        const label = stroke.label ?? 1
        const diameter = ctx.lineWidth
        const cx = nx * current.width
        const cy = ny * current.height
        const fontSize = numberStickerFontSize(diameter, label)
        ctx.save()
        ctx.globalAlpha = NUMBER_STICKER_OPACITY
        ctx.beginPath()
        ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = contrastingTextColor(stroke.color)
        ctx.font = `bold ${fontSize}px ${NUMBER_FONT_STACK}`
        ctx.textAlign = "center"
        ctx.textBaseline = "alphabetic"
        ctx.fillText(String(label), cx, cy + fontSize * NUMBER_TEXT_BASELINE_RATIO)
        ctx.restore()
        continue
      }
      if (stroke.kind === "arrow") {
        // La misma geometría del servidor: lo dibujado es lo guardado.
        // points = [punta, cola].
        const [tip, tail] = stroke.points
        const g = arrowGeometry(
          { x: tail[0], y: tail[1] },
          { x: tip[0], y: tip[1] },
          ctx.lineWidth,
          current.width,
          current.height
        )
        ctx.beginPath()
        ctx.moveTo(g.tailX, g.tailY)
        ctx.lineTo(g.tipX, g.tipY)
        ctx.stroke()
        // Punta triangular (la base retrocede hacia la cola).
        const baseX = g.tipX - g.dirX * g.headLen
        const baseY = g.tipY - g.dirY * g.headLen
        const perpX = -g.dirY
        const perpY = g.dirX
        ctx.beginPath()
        ctx.moveTo(g.tipX, g.tipY)
        ctx.lineTo(baseX + perpX * g.headHalf, baseY + perpY * g.headHalf)
        ctx.lineTo(baseX - perpX * g.headHalf, baseY - perpY * g.headHalf)
        ctx.closePath()
        ctx.fill()
        continue
      }
      if (stroke.points.length === 1) {
        const [x, y] = stroke.points[0]
        ctx.beginPath()
        ctx.arc(x * current.width, y * current.height, ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.beginPath()
      stroke.points.forEach(([x, y], index) => {
        const px = x * current.width
        const py = y * current.height
        if (index === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
    }
  }, [])

  /**
   * Ajusta la caja de la imagen al área disponible sin deformarla y alinea el
   * canvas exactamente al rectángulo visible (sin bandas de letterboxing que
   * capturen trazos). Al redimensionar se recalcula sin perder trazos: están
   * normalizados.
   */
  const measure = React.useCallback(() => {
    const area = areaRef.current
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!area || !img || !canvas || !img.naturalWidth || !img.naturalHeight) return
    const rect = area.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    const aspect = img.naturalWidth / img.naturalHeight
    const areaAspect = rect.width / rect.height
    const next: BoxSize =
      aspect > areaAspect
        ? { width: rect.width, height: rect.width / aspect }
        : { height: rect.height, width: rect.height * aspect }
    const snapped = { width: Math.floor(next.width), height: Math.floor(next.height) }
    boxRef.current = snapped
    setBox(snapped)
    // Buffer del canvas con devicePixelRatio acotado: nitidez táctil sin un
    // canvas a resolución original en el móvil.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(Math.round(snapped.width * dpr), 1)
    canvas.height = Math.max(Math.round(snapped.height * dpr), 1)
    // Un cambio de tamaño puede dejar el paneo fuera de rango: se re-acota.
    clampTransform()
    applyTransform()
    redraw()
  }, [applyTransform, clampTransform, redraw])

  React.useEffect(() => {
    const area = areaRef.current
    if (!area || typeof ResizeObserver === "undefined") {
      const onResize = () => measure()
      window.addEventListener("resize", onResize)
      return () => window.removeEventListener("resize", onResize)
    }
    const observer = new ResizeObserver(() => measure())
    observer.observe(area)
    return () => observer.disconnect()
  }, [measure])

  // Zoom con rueda y trackpad (el pellizco del trackpad llega como wheel
  // con ctrlKey): oyente no pasivo para poder cancelar el gesto del
  // navegador dentro del área de dibujo.
  React.useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const onWheel = (event: WheelEvent) => {
      if (!boxRef.current) return
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoomAt(event.clientX, event.clientY, Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY))
    }
    area.addEventListener("wheel", onWheel, { passive: false })
    return () => area.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  function handleImageLoad() {
    // Imagen nueva (o reintento): el zoom vuelve al ajuste inicial.
    resetZoom()
    setPhase("ready")
    measure()
  }

  function handleImageError() {
    const img = imgRef.current
    if (!img) return
    if (img.dataset.fallback !== "1") {
      // La variante baja falló (formato sin derivar, respuesta rota): el
      // original es el respaldo.
      img.dataset.fallback = "1"
      img.src = image.file.url
      return
    }
    setPhase("error")
  }

  function retryImage() {
    const img = imgRef.current
    setPhase("loading")
    if (!img) return
    delete img.dataset.fallback
    img.src = `${lowSource}${lowSource.includes("?") ? "&" : "?"}r=${Date.now()}`
  }

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    return [x, y]
  }

  function strokeWidthPx(): number {
    return Math.max(STROKE_WIDTH_RATIO * (boxRef.current?.width ?? 0), 1)
  }

  /** Confirma el sticker numerado en el punto tocado (toque del modo Números). */
  function commitNumero(point: [number, number]) {
    let label = 1
    for (const stroke of strokesRef.current) {
      if (stroke.kind === "numero" && (stroke.label ?? 0) >= label) {
        label = (stroke.label ?? 0) + 1
      }
    }
    const stroke: DrawStroke = {
      kind: "numero",
      color,
      width: NUMBER_STICKER_SIZE_RATIO,
      points: [point],
      label,
    }
    strokesRef.current = [...strokesRef.current, stroke]
    totalPointsRef.current += 1
    setStrokes(strokesRef.current)
    redraw()
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (phase !== "ready" || saving) return
    // Solo el botón primario dibuja: clic derecho/central no crean trazos,
    // stickers ni pellizcos.
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (pointersRef.current.has(event.pointerId)) return
    // Registro todos los dedos: uno dibuja, dos entran en pellizco.
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Navegadores sin captura: el trazo sigue dentro del canvas.
    }
    if (pointersRef.current.size === 2) {
      // Segundo dedo: cancela lo que estaba a medio hacer (trazo en
      // pantalla o sticker pendiente) y arranca el pellizco.
      const canceled = currentStrokeRef.current
      currentStrokeRef.current = null
      pendingNumeroRef.current = null
      activePointerRef.current = null
      if (canceled?.kind === "path") totalPointsRef.current -= canceled.points.length
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        startDist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
        startMidX: (a.x + b.x) / 2,
        startMidY: (a.y + b.y) / 2,
        startZoom: transformRef.current.zoom,
        startX: transformRef.current.x,
        startY: transformRef.current.y,
      }
      redraw() // limpia la vista previa cancelada
      return
    }
    if (pointersRef.current.size > 2) return // dedos extra: no participan
    activePointerRef.current = event.pointerId
    const point = pointFromEvent(event)
    if (modeRef.current === "numeros") {
      // Sticker numerado: se confirma al soltar (tap), así un pellizco que
      // empiece a mitad no deja un sticker accidental.
      pendingNumeroRef.current = point
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    const current = boxRef.current
    if (modeRef.current === "flecha") {
      // Flecha: el primer toque es la punta (el punto al que apunta); la
      // cola se define al arrastrar y soltar.
      const stroke: DrawStroke = {
        kind: "arrow",
        color,
        width: STROKE_WIDTH_RATIO,
        points: [point, point],
      }
      currentStrokeRef.current = stroke
      redraw()
      return
    }
    const stroke: DrawStroke = {
      kind: "path",
      color,
      width: STROKE_WIDTH_RATIO,
      points: [point],
    }
    currentStrokeRef.current = stroke
    totalPointsRef.current += 1
    // El toque puntual se ve al instante (punto, no trazo fantasma).
    if (ctx && current) {
      const [x, y] = point
      ctx.fillStyle = stroke.color
      ctx.beginPath()
      ctx.arc(x * current.width, y * current.height, strokeWidthPx() / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    // Pellizco activo: zoom por la razón de distancias y paneo por el
    // punto medio, con el ancla inicial fija en la imagen (sin render de
    // React; el transform se escribe directo).
    const pinch = pinchRef.current
    if (pinch && pointersRef.current.size >= 2) {
      const rect = areaRef.current?.getBoundingClientRect()
      if (!rect || rect.width < 1 || rect.height < 1) return
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
      const zoom = Math.min(
        Math.max(pinch.startZoom * (dist / pinch.startDist), MIN_ZOOM),
        MAX_ZOOM
      )
      const ratio = zoom / pinch.startZoom
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const sx = midX - (rect.left + rect.width / 2)
      const sy = midY - (rect.top + rect.height / 2)
      transformRef.current.zoom = zoom
      transformRef.current.x = sx - ratio * (pinch.startMidX - (rect.left + rect.width / 2) - pinch.startX)
      transformRef.current.y = sy - ratio * (pinch.startMidY - (rect.top + rect.height / 2) - pinch.startY)
      clampTransform()
      applyTransform()
      return
    }

    if (activePointerRef.current !== event.pointerId) return
    const stroke = currentStrokeRef.current
    const current = boxRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!stroke || !current || !ctx) return
    const point = pointFromEvent(event)
    if (stroke.kind === "arrow") {
      // Vista previa completa en cada movimiento (punta fija donde se tocó,
      // cola siguiendo al puntero): es un repintado desde los trazos
      // confirmados, sin render de React.
      stroke.points[1] = point
      redraw()
      return
    }
    const last = stroke.points[stroke.points.length - 1]
    // Puntos demasiado cercanos no se guardan: el trazo pesa lo mismo y se
    // ve igual, y el límite de puntos alcanza para mucho más dibujo. El
    // mínimo es en píxeles de pantalla: con zoom, menos recorrido de
    // imagen cuenta como distancia suficiente.
    const minDistance = 1.5 / transformRef.current.zoom
    const distance = Math.hypot(
      (point[0] - last[0]) * current.width,
      (point[1] - last[1]) * current.height
    )
    if (distance < minDistance) return
    if (totalPointsRef.current >= MAX_ANNOTATION_POINTS) {
      if (!limitToastShownRef.current) {
        limitToastShownRef.current = true
        toast.error("Alcanzaste el límite de trazos del editor: usa Deshacer o guarda el dibujo.")
      }
      return
    }
    stroke.points.push(point)
    totalPointsRef.current += 1
    // Pintado incremental: sin render de React por movimiento.
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = Math.max(stroke.width * current.width, 1)
    ctx.beginPath()
    ctx.moveTo(last[0] * current.width, last[1] * current.height)
    ctx.lineTo(point[0] * current.width, point[1] * current.height)
    ctx.stroke()
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.delete(event.pointerId)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Sin captura previa no hay nada que liberar.
    }

    // Fin del pellizco (quedaron menos de dos dedos): se sincroniza el
    // indicador y los dedos restantes no dibujan por accidente — el trazo
    // siguiente exige un toque nuevo.
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) {
        pinchRef.current = null
        pointersRef.current.clear()
        clampTransform()
        applyTransform()
        setZoomLabel(transformRef.current.zoom)
      }
      return
    }

    // Tap del modo Números: se confirma solo si el gesto terminó siendo un
    // toque limpio (sin segundo dedo) y con soltar (pointercancel no pega
    // stickers a medias).
    if (pendingNumeroRef.current) {
      const pending = pendingNumeroRef.current
      pendingNumeroRef.current = null
      if (event.type === "pointerup") commitNumero(pending)
      return
    }

    if (activePointerRef.current !== event.pointerId) return
    activePointerRef.current = null
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    if (!stroke) return
    if (stroke.kind === "arrow") {
      const current = boxRef.current
      const [tip, tail] = stroke.points
      const dragged =
        current !== null &&
        Math.hypot(
          (tail[0] - tip[0]) * current.width,
          (tail[1] - tip[1]) * current.height
        ) >= MIN_ARROW_DRAG_PX / transformRef.current.zoom
      // Un tap sin arrastre no crea una flecha invisible; el gesto
      // cancelado (pointercancel) tampoco: no hay media flecha. En ambos
      // casos el repintado limpia la vista previa. El mínimo es en
      // píxeles de pantalla: con zoom basta menos recorrido de imagen.
      if (!dragged || event.type !== "pointerup") {
        redraw()
        return
      }
      strokesRef.current = [...strokesRef.current, stroke]
      setStrokes(strokesRef.current)
      // La flecha confirmada se pinta de una vez (la vista previa se borró).
      redraw()
      return
    }
    // pointercancel conserva lo dibujado: ningún gesto se pierde a medias ni
    // une movimientos de gestos separados (cada trazo empieza en pointerdown).
    strokesRef.current = [...strokesRef.current, stroke]
    setStrokes(strokesRef.current)
  }

  function undo() {
    if (!strokesRef.current.length || saving) return
    const next = strokesRef.current.slice(0, -1)
    strokesRef.current = next
    totalPointsRef.current = next.reduce((sum, stroke) => sum + stroke.points.length, 0)
    limitToastShownRef.current = false
    setStrokes(next)
    redraw()
  }

  const hasStrokes = strokes.length > 0

  /**
   * Cierre con cambios pendientes: pide confirmación de descarte (nunca
   * guarda al tocar fuera). Mientras se guarda, el cierre queda bloqueado.
   */
  const requestClose = React.useCallback(() => {
    if (saving) return
    if (strokesRef.current.length > 0) {
      setConfirmDiscard(true)
      return
    }
    onOpenChange(false)
  }, [onOpenChange, saving])

  function discard() {
    setConfirmDiscard(false)
    strokesRef.current = []
    setStrokes([])
    totalPointsRef.current = 0
    onOpenChange(false)
  }

  async function save() {
    const pending = strokesRef.current
    if (!pending.length || saving || phase !== "ready") return
    setSaving(true)
    try {
      // No se reintenta automáticamente: si la respuesta se pierde tras el
      // guardado, repetir el POST crearía una segunda copia.
      const response = await fetch(`/api/images/${image.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strokes: pending }),
      })
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean
        data?: { image?: DrawEditorSavedImage }
        error?: { message?: string }
      } | null
      if (!response.ok || !body?.ok || !body.data?.image) {
        toast.error(
          body?.error?.message ??
            "No se pudo guardar el dibujo. Tus trazos siguen en el editor; inténtalo de nuevo."
        )
        return
      }
      onSaved(body.data.image)
    } catch {
      toast.error(
        "No se pudo conectar con el servidor. Tus trazos siguen en el editor; inténtalo de nuevo."
      )
    } finally {
      setSaving(false)
    }
  }

  const colorLabel =
    STROKE_COLORS.find((option) => option.value === color)?.label ?? color.toUpperCase()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogContent
        className={cn(
          "inset-0 flex h-dvh w-auto max-w-none translate-x-0 translate-y-0",
          "flex-col gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 sm:max-w-none"
        )}
        showCloseButton={false}
      >
        <DialogDescription className="sr-only">
          Dibuja con el dedo, el ratón o el lápiz; coloca flechas o stickers
          con números en secuencia. Pellizca con dos dedos o usa la rueda
          para acercar la imagen. Al aceptar se guarda una copia en la
          galería; el original no cambia.
        </DialogDescription>

        <header
          className="flex items-center justify-between gap-2 border-b px-3 pb-2"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-sm font-semibold tracking-tight">
              Dibujar
            </DialogTitle>
            <p className="text-muted-foreground truncate text-xs">
              {mode === "flecha"
                ? "Toca donde la flecha debe apuntar y arrastra hasta la cola."
                : mode === "numeros"
                  ? "Toca para colocar el siguiente número en secuencia."
                  : "Señala o dibuja sobre la imagen; se guarda una copia."}
            </p>
          </div>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Cerrar el editor de dibujo"
                title="Cerrar"
                disabled={saving}
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </header>

        {/* Área de dibujo: la imagen contenida y el canvas pegado a su
            rectángulo exacto. */}
        <div
          ref={areaRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted"
        >
          <div
            ref={wrapperRef}
            className="relative"
            style={box ? { ...box, willChange: "transform" } : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía */}
            <img
              ref={imgRef}
              src={lowSource}
              alt=""
              onLoad={handleImageLoad}
              onError={handleImageError}
              decoding="async"
              draggable={false}
              className={cn(
                "pointer-events-none block h-full w-full select-none",
                phase === "ready" ? "opacity-100" : "opacity-0"
              )}
            />
            <canvas
              ref={canvasRef}
              aria-label="Superficie de dibujo sobre la imagen"
              className={cn(
                "absolute inset-0 h-full w-full cursor-crosshair touch-none",
                phase === "ready" ? "opacity-100" : "opacity-0"
              )}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
            />
          </div>

          {zoomLabel > 1.005 && phase === "ready" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute top-3 right-3 h-9 px-3"
              onClick={resetZoom}
              title="Volver al tamaño original"
              aria-label="Restablecer el zoom de la imagen"
            >
              <Maximize2Icon data-icon="inline-start" aria-hidden="true" />
              {Math.round(zoomLabel * 100)} %
            </Button>
          ) : null}

          {phase === "loading" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Spinner className="size-6" />
              <p role="status" className="text-muted-foreground text-sm">
                Cargando imagen…
              </p>
            </div>
          ) : null}
          {phase === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p role="alert" className="text-sm">
                No se pudo cargar la imagen.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-11 px-4"
                  onClick={retryImage}
                >
                  Reintentar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="h-11 px-4"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Herramientas: tipo de dibujo, color del trazo y Deshacer por
            trazo. En pantallas muy angostas el renglón parte en dos en vez
            de encoger los controles táctiles. */}
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          {/* Un solo modo activo: el grupo alterna y nunca queda vacío. */}
          <ToggleGroup
            variant="default"
            value={[mode]}
            disabled={saving}
            aria-label="Tipo de dibujo"
            onValueChange={(value) => {
              const next = value[value.length - 1]
              if (next === "lapiz" || next === "flecha" || next === "numeros") {
                setMode(next)
              }
            }}
          >
            <ToggleGroupItem
              value="lapiz"
              className="h-11 gap-1.5 px-3 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
            >
              <PencilIcon data-icon="inline-start" aria-hidden="true" />
              Lápiz
            </ToggleGroupItem>
            <ToggleGroupItem
              value="flecha"
              className="h-11 gap-1.5 px-3 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
            >
              <ArrowUpRightIcon data-icon="inline-start" aria-hidden="true" />
              Flecha
            </ToggleGroupItem>
            <ToggleGroupItem
              value="numeros"
              className="h-11 gap-1.5 px-3 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
            >
              <ListOrderedIcon data-icon="inline-start" aria-hidden="true" />
              Números
            </ToggleGroupItem>
          </ToggleGroup>
          <ColorPicker
            value={color}
            onValueChange={(next) => {
              if (next) setColor(next)
            }}
            format="hex"
            i18n={{
              ...PICKER_I18N,
              labels: {
                ...PICKER_I18N.labels,
                panelLabel:
                  mode === "numeros" ? "Color del sticker" : "Color del trazo",
              },
            }}
          >
            <ColorPickerTrigger
              size="lg"
              className="h-11 gap-2 px-3"
              disabled={saving}
            >
              <ColorPickerSwatch shape="circle" />
              <span className="text-xs">{colorLabel}</span>
            </ColorPickerTrigger>
            <ColorPickerContent align="start">
              <ColorPickerPanel>
                <ColorPickerArea />
                <ColorPickerSlider channel="hue" />
                <ColorPickerSwatches colors={STROKE_COLORS} shape="circle" />
              </ColorPickerPanel>
            </ColorPickerContent>
          </ColorPicker>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="ml-auto h-11"
            onClick={undo}
            disabled={!hasStrokes || saving}
            title="Quita el último trazo"
          >
            <Undo2Icon data-icon="inline-start" aria-hidden="true" />
            Deshacer
          </Button>
        </div>

        <footer
          className="flex items-center justify-between gap-2 border-t px-3 pb-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="h-11 px-4"
            onClick={requestClose}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-11 px-5"
            onClick={() => void save()}
            disabled={!hasStrokes || saving || phase !== "ready"}
          >
            {saving ? (
              <Spinner className="size-4" data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {saving ? "Guardando…" : "Aceptar"}
          </Button>
        </footer>
      </DialogContent>

      {/* Descarte confirmado: los trazos sin guardar se pierden y la copia
          todavía no existe. */}
      <AlertDialog
        open={confirmDiscard}
        onOpenChange={(next) => {
          if (!next) setConfirmDiscard(false)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>¿Descartar el dibujo?</AlertDialogTitle>
            <AlertDialogDescription>
              Los trazos que no hayas guardado se perderán. La copia aún no se
              ha creado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Seguir dibujando</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              className="dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
              onClick={discard}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
