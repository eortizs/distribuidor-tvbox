"use client"

import * as React from "react"
import {
  ArrowUpRightIcon,
  CheckIcon,
  PencilIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import {
  arrowGeometry,
  MAX_ANNOTATION_POINTS,
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
 * Editor de dibujo a pantalla completa para una imagen de Galería, con dos
 * herramientas: lápiz a mano alzada y flechas (se toca el punto al que la
 * flecha debe apuntar y se arrastra hasta la cola). Ambas conservan los
 * trazos como puntos normalizados (0..1) respecto a la imagen, así que
 * rotar o cambiar el tamaño no los desplaza, y el servidor compone el mismo
 * dibujo sobre el original a su resolución al aceptar (el original nunca se
 * modifica). La geometría de la flecha es la misma que rasteriza el
 * servidor.
 */

interface DrawStroke {
  /** `path` (lápiz) o `arrow` (flecha). */
  kind: AnnotationStrokeKind
  color: string
  /** Grosor como fracción del ancho de la imagen. */
  width: number
  /** `path`: puntos del gesto. `arrow`: [punta, cola] — la punta es donde
   * se tocó primero (el punto al que apunta la flecha). */
  points: [number, number][]
}

type DrawMode = "lapiz" | "flecha"

/** Arrastre mínimo para que una flecha cuente: un tap sin arrastre no crea
 * nada (evita flechas invisibles por toques accidentales). */
const MIN_ARROW_DRAG_PX = 8

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
  // Herramienta activa: lápiz libre o flecha numerada. El ref acompaña al
  // estado para que los manejadores del canvas (eventos) lean siempre la
  // herramienta vigente sin depender del ciclo de render.
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
    redraw()
  }, [redraw])

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

  function handleImageLoad() {
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

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (phase !== "ready" || saving) return
    // Un solo puntero activo: dedo, ratón o stylus, nunca varios a la vez.
    if (activePointerRef.current !== null) return
    activePointerRef.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Navegadores sin captura: el trazo sigue dentro del canvas.
    }
    const point = pointFromEvent(event)
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
    // ve igual, y el límite de puntos alcanza para mucho más dibujo.
    const distance = Math.hypot(
      (point[0] - last[0]) * current.width,
      (point[1] - last[1]) * current.height
    )
    if (distance < 1.5) return
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
    if (activePointerRef.current !== event.pointerId) return
    activePointerRef.current = null
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Sin captura previa no hay nada que liberar.
    }
    if (!stroke) return
    if (stroke.kind === "arrow") {
      const current = boxRef.current
      const [tip, tail] = stroke.points
      const dragged =
        current !== null &&
        Math.hypot(
          (tail[0] - tip[0]) * current.width,
          (tail[1] - tip[1]) * current.height
        ) >= MIN_ARROW_DRAG_PX
      // Un tap sin arrastre no crea una flecha invisible; el gesto
      // cancelado (pointercancel) tampoco: no hay media flecha. En ambos
      // casos el repintado limpia la vista previa.
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
          Dibuja con el dedo, el ratón o el lápiz para señalar detalles. Al
          aceptar se guarda una copia en la galería; el original no cambia.
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
          <div className="relative" style={box ?? undefined}>
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
              if (next === "lapiz" || next === "flecha") setMode(next)
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
          </ToggleGroup>
          <ColorPicker
            value={color}
            onValueChange={(next) => {
              if (next) setColor(next)
            }}
            format="hex"
            i18n={PICKER_I18N}
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
