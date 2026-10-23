"use client"

import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  ImageDownIcon,
  ImageIcon,
  MicIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Share2Icon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TOTAL_BYTES,
  REFERENCE_IMAGE_TYPES,
} from "@/lib/attachments"
import {
  canShareFiles,
  hasShareSheet,
  imageToPng,
  shareImage,
  type ShareTarget,
} from "@/lib/share"

import { Badge } from "@/components/reui/badge"
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTrigger,
} from "@/components/reui/stepper"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ASPECT_OPTIONS,
  type ImageLevel,
} from "@/server/images/models"
import {
  AttachmentChips,
  type AttachmentItem,
  type AttachmentStatus,
} from "@/components/herramientas/attachment-chips"
import {
  formatBytes,
  useFileUpload,
  type FileWithPreview,
} from "@/hooks/use-file-upload"
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"

interface ImageVariant {
  variant: "low" | "thumb"
  url: string
  fileName: string
  mimeType: string
  /** null mientras la variante no se ha derivado. */
  sizeBytes: number | null
  width: number | null
  height: number | null
}

interface ImageFile {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
  /** Versiones derivadas del original (la que se ve en el celular y la
   * miniatura de la galería). */
  variants?: {
    low: ImageVariant
    thumb: ImageVariant
  }
}

interface ImageGeneration {
  id: string
  prompt: string
  model: string
  aspectRatio: string | null
  quality: string | null
  costUsd: number | null
  costMxn: number | null
  createdAt: string
  file: ImageFile | null
}

type ListState = "loading" | "ready" | "error"

type ReferenceState = {
  id: string
  /** Id del archivo ya subido al almacenamiento del usuario. */
  serverId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  status: AttachmentStatus
}

const MAX_PROMPT_LENGTH = 2000

/**
 * Junta el texto que ya estaba en el área con lo que se dictó. Cada sesión de
 * dictado se agrega a lo escrito antes y el resultado nunca pasa del límite
 * del área.
 */
function joinPrompt(base: string, spoken: string): string {
  const clean = spoken.trim()
  const previous = base.trim()
  const joined = clean ? (previous ? `${previous} ${clean}` : clean) : base
  return joined.length > MAX_PROMPT_LENGTH
    ? joined.slice(0, MAX_PROMPT_LENGTH)
    : joined
}

/** Copy del dictado según su estado: una sola fuente para botón, tooltip,
 *  estado de escucha y avisos. */
function dictationCopy(supported: boolean, listening: boolean) {
  if (!supported) {
    return {
      label: "Dictado por voz no disponible",
      tooltip: "El dictado por voz no está disponible aquí",
      error:
        "El dictado por voz no está disponible aquí. Usa Chrome, Edge o Safari en una conexión segura.",
      status: "",
    }
  }
  if (listening) {
    return {
      label: "Detener el dictado",
      tooltip: "Detener el dictado",
      error: "",
      status: "Escuchando… detén el micrófono cuando termines.",
    }
  }
  return {
    label: "Dictar la descripción",
    tooltip: "Dictar la descripción con la voz",
    error: "",
    status: "",
  }
}

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
})

// Solo el día: el visor lleva la fecha bajo la imagen, sin la hora.
const dayFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
})

const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
})

function mxn(value: number): string {
  return `${mxnFormatter.format(value)} MXN`
}

function costLabel(image: { costUsd: number | null; costMxn: number | null }): string {
  if (image.costMxn !== null) return mxn(image.costMxn)
  return image.costUsd === null ? "s/d" : `US$${image.costUsd.toFixed(4)}`
}

/**
 * Proporción CSS de la miniatura. Se toma de la miniatura derivada (que
 * conserva la proporción real de la imagen) y, si todavía no existe, del
 * aspecto con el que se generó ("9:16" → "9 / 16"). Sin aspecto conocido,
 * la imagen se muestra con su tamaño natural.
 */
function aspectStyle(
  aspect: string | null,
  variant?: ImageVariant | null
): React.CSSProperties | undefined {
  if (variant?.width && variant?.height) {
    return { aspectRatio: `${variant.width} / ${variant.height}` }
  }
  if (!aspect || aspect === "auto") return undefined
  const [width, height] = aspect.split(":")
  if (!width || !height) return undefined
  return { aspectRatio: `${width} / ${height}` }
}

/** Miniatura de la galería: lo único que baja el listado. */
function thumbSource(file: ImageFile): string {
  return file.variants?.thumb?.url ?? file.url
}

/** Versión que se ve al abrir la imagen: cabe en la pantalla del celular. */
function lowSource(file: ImageFile): string {
  return file.variants?.low?.url ?? file.url
}

/** Nombre del archivo de la versión baja (el que se comparte). */
function lowFileName(file: ImageFile): string {
  const variant = file.variants?.low?.fileName
  if (variant) return variant
  const base = file.fileName.replace(/\.[^.]+$/, "").trim() || "imagen"
  return `${base}-baja.webp`
}

/**
 * URL de la versión baja. Se arma con el id del archivo para que siempre sea
 * la variante de 1280 px: si falta, el servidor la deriva del original al
 * pedarla (`ensureFileVariant`).
 */
function lowVariantUrl(file: ImageFile): string {
  return `/api/files/${file.id}?variant=low`
}

/** URL de descarga de un archivo o de una variante. */
function downloadUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`
}

/**
 * Descarga la versión baja de la imagen y la deja lista para compartir: el
 * archivo tal cual (WebP) y, si el navegador tiene hoja de compartir pero no
 * acepta el WebP, su versión PNG (compartir no puede esperar a una
 * conversión: Safari exige que la llamada salga del gesto del usuario).
 */
async function fetchShareTarget(
  file: ImageFile,
  signal?: AbortSignal
): Promise<ShareTarget> {
  const response = await fetch(lowVariantUrl(file), {
    signal,
    credentials: "same-origin",
  })
  if (!response.ok) throw new Error("share-download-failed")
  const blob = await response.blob()
  const shared = new File([blob], lowFileName(file), {
    type: blob.type || "image/webp",
  })
  const target: ShareTarget = { file: shared, png: null }
  if (hasShareSheet() && !canShareFiles([shared])) {
    try {
      target.png = await imageToPng(blob)
    } catch {
      target.png = null
    }
  }
  return target
}

/** Dominio de una fuente, sin "www.": es la etiqueta corta de cada enlace. */
function domainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

const sourceDateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
})

/** Fecha de publicación de la fuente ("20 oct"): deja ver la frescura del
 * respaldo; si no hay fecha o no se puede leer, no se muestra nada. */
function sourceDateLabel(raw: string | null | undefined): string {
  if (!raw) return ""
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return ""
  const date = new Date(parsed)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear
    ? sourceDateFormatter.format(date)
    : `${sourceDateFormatter.format(date)} ${date.getFullYear()}`
}

/**
 * Si una variante no se puede cargar (formato no soportado, archivo sin
 * derivar) se cae al original en vez de dejar un hueco en la galería.
 */
function fallbackToOriginal(
  originalUrl: string
): (event: React.SyntheticEvent<HTMLImageElement>) => void {
  return (event) => {
    const img = event.currentTarget
    if (img.dataset.fallback === "1") return
    img.dataset.fallback = "1"
    img.src = originalUrl
  }
}

/**
 * Cerrar del diálogo: el de la librería es *ghost* y su fondo solo aparece al
 * pasar el mouse, así que en móvil la X quedaba invisible sobre la imagen.
 * Este lleva un fondo redondo siempre visible.
 */
function ViewerCloseButton() {
  return (
    <DialogClose
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70"
          title="Cerrar"
        />
      }
    >
      <XIcon aria-hidden="true" />
      <span className="sr-only">Cerrar</span>
    </DialogClose>
  )
}

type ImageStudioProps = {
  /** Niveles del control de calidad (modelo por nivel) del usuario. */
  levels: readonly ImageLevel[]
}

export function ImageStudio({ levels }: ImageStudioProps = { levels: [] }) {
  const [images, setImages] = React.useState<ImageGeneration[]>([])
  const [total, setTotal] = React.useState(0)
  const [listState, setListState] = React.useState<ListState>("loading")

  const [prompt, setPrompt] = React.useState("")
  // Paso del flujo de un solo botón: `false` = el texto todavía no se ha
  // procesado (paso 1, *Procesar descripción*); `true` = la investigación ya
  // reescribió el prompt y el mismo botón pasa a *Generar* (paso 2). Cualquier
  // edición manual del texto regresa al paso 1: lo procesado ya no corresponde
  // a lo que hay en el área.
  const [promptProcessed, setPromptProcessed] = React.useState(false)
  // Descripción del usuario tal como la escribió, antes de que el modelo la
  // reescribiera con la investigación: es la base limpia de cada intento, para
  // que *Regenerar* repita la búsqueda desde cero y no desde el texto ya
  // expandido. Se descarta cuando el usuario edita a mano el texto.
  const [sourcePrompt, setSourcePrompt] = React.useState<string | null>(null)
  // Por omisión la herramienta genera en formato póster (9:16): es la
  // relación que más usa este panel.
  const [aspectRatio, setAspectRatio] = React.useState<string>("9:16")
  // El nivel (media/alta) es lo que elige el usuario; cada nivel trae el
  // modelo, la calidad y el tamaño configurados en Configuración. Por
  // omisión se abre en "Alta" (si el usuario no configuró ese nivel, en el
  // primero disponible).
  const [qualityIndex, setQualityIndex] = React.useState(() => {
    const alta = levels.findIndex((level) => level.id === "alta")
    return alta >= 0 ? alta : 0
  })
  const [generating, setGenerating] = React.useState(false)
  const [enhancing, setEnhancing] = React.useState(false)
  const [generateError, setGenerateError] = React.useState<string | null>(null)
  // Fuentes que el modelo consultó al insertar los detalles: se muestran
  // bajo el botón para que el usuario sepa de dónde salió la información.
  const [detailSources, setDetailSources] = React.useState<
    { title: string; url: string }[]
  >([])
  // Aviso del modelo cuando la petición se apoya en un hecho que no
  // ocurrió: se muestra aparte, para no contaminar el prompt.
  const [detailNote, setDetailNote] = React.useState<string | null>(null)
  // Datos confirmados por la investigación (cada uno con sus fuentes): se
  // muestran bajo el botón para que el usuario sepa qué se verificó.
  const [detailFacts, setDetailFacts] = React.useState<
    {
      value: string
      sources: { title: string; url: string; publishedDate?: string | null }[]
    }[]
  >([])

  const activeQualityIndex = Math.min(
    qualityIndex,
    Math.max(levels.length - 1, 0)
  )
  const selectedLevel = levels[activeQualityIndex] ?? levels[0]

  // La lista de aspectos es la misma en todos los niveles: es el modelo
  // configurado el que la aplica (el que lo admite, la recorta a la más
  // cercana en el servidor).
  const aspectOptions = ASPECT_OPTIONS

  // Aspecto efectivo: si el modelo del nivel no admite el aspecto elegido
  // (p. ej. tras cambiar de nivel), se usa "Automático", que aplica el
  // tamaño configurado para el nivel.
  const activeAspect = aspectOptions.some(
    (option) => option.value === aspectRatio
  )
    ? aspectRatio
    : "auto"

  const [references, setReferences] = React.useState<Record<string, ReferenceState>>({})
  const [referenceError, setReferenceError] = React.useState<string | null>(null)
  // Subidas en vuelo: al quitar un chip se aborta la suya para no dejar el
  // archivo huérfano en el disco.
  const uploadControllers = React.useRef(new Map<string, AbortController>())
  const removedReferenceIds = React.useRef(new Set<string>())

  const [viewer, setViewer] = React.useState<ImageGeneration | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  // El botón de copiar avisa durante un par de segundos de que la
  // descripción ya está en el portapapeles.
  const [copied, setCopied] = React.useState(false)
  // Compartir está en curso (la hoja del sistema o la copia al portapapeles).
  const [sharing, setSharing] = React.useState(false)
  // Segundo nivel sobre el visor: la imagen sola, a pantalla completa.
  const [zoomed, setZoomed] = React.useState(false)
  const copyResetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  // Archivo listo para compartir, por id de imagen: se prepara al abrir el
  // visor para que al compartir no haya que esperar la descarga.
  const shareTargets = React.useRef(new Map<string, ShareTarget>())

  const [tab, setTab] = React.useState("generar")

  const [reloadToken, setReloadToken] = React.useState(0)

  const promptRef = React.useRef<HTMLTextAreaElement>(null)

  /**
   * Cambia el prompt (a mano o por voz): el texto deja de corresponder a lo
   * que el modelo procesó, así que el flujo regresa al paso 1. Es la única
   * puerta de escritura del prompt con reinicio, para que no deriven copias
   * de este bloque.
   */
  const applyPromptEdit = React.useCallback((next: string) => {
    setPrompt(next)
    setPromptProcessed(false)
    // El texto ya no viene del modelo: la base limpia que guardaba el
    // intento anterior deja de servir y el flujo vuelve al paso 1.
    setSourcePrompt(null)
    setDetailSources([])
    setDetailFacts([])
    setDetailNote(null)
  }, [])

  // Dictado por voz: `dictationBase` es lo que había escrito cuando empezó la
  // sesión, para que cada sesión se agregue a lo escrito antes. Va en un ref
  // porque el reconocedor puede devolver palabras antes de que el área se
  // vuelva a pintar.
  const dictationBaseRef = React.useRef("")
  // Si el usuario escribe mientras se dicta, lo escrito manda: la sesión se
  // cierra sin guardar lo dictado.
  const dictationCancelledRef = React.useRef(false)

  const {
    isSupported: dictationSupported,
    isListening: dictating,
    error: dictationError,
    start: startDictation,
    stop: stopDictation,
  } = useSpeechRecognition({
    lang: "es-MX",
    // El texto dictado entra por `applyPromptEdit`: solo cuando de verdad
    // cambia el texto se reinicia lo procesado (una sesión vacía no toca
    // nada).
    onTranscript: (text) => {
      if (dictationCancelledRef.current || !text.trim()) return
      applyPromptEdit(joinPrompt(dictationBaseRef.current, text))
    },
    onEnd: (text) => {
      const base = dictationBaseRef.current
      dictationBaseRef.current = ""
      if (dictationCancelledRef.current) {
        dictationCancelledRef.current = false
        return
      }
      if (text.trim()) {
        applyPromptEdit(joinPrompt(base, text))
      }
      promptRef.current?.focus()
    },
  })

  // Copy del dictado disponible desde aquí: el toast de "no soportado" y el
  // botón comparten la misma fuente.
  const dictation = dictationCopy(dictationSupported, dictating)

  const toggleDictation = React.useCallback(() => {
    if (dictating) {
      stopDictation()
      return
    }
    if (!dictationSupported) {
      toast.error(dictation.error)
      return
    }
    // Mientras vuela una investigación o una generación no se dicta: la
    // respuesta llegaría y pisaría el texto dictado (o al revés).
    if (enhancing || generating) return
    dictationBaseRef.current = prompt
    startDictation()
  }, [
    dictating,
    dictation,
    dictationSupported,
    enhancing,
    generating,
    prompt,
    startDictation,
    stopDictation,
  ])

  React.useEffect(() => {
    if (!dictationError) return
    toast.error(dictationError)
  }, [dictationError])

  const [
    { files: pickedFiles },
    { openFileDialog, getInputProps, removeFile },
  ] = useFileUpload({
    multiple: true,
    maxFiles: MAX_REFERENCE_FILES,
    maxSize: MAX_REFERENCE_BYTES,
    accept: REFERENCE_IMAGE_TYPES.join(","),
    onFilesAdded: (added) => {
      void uploadReferences(added)
    },
    onError: () => {
      setReferenceError(
        `Solo se admiten imágenes (${REFERENCE_IMAGE_TYPES.map((type) => type.replace("image/", "")).join(", ")}) de hasta ${formatBytes(MAX_REFERENCE_BYTES)} y máximo ${MAX_REFERENCE_FILES} por generación.`
      )
    },
  })

  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/images", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          ok: boolean
          data?: {
            images: ImageGeneration[]
            total: number
          }
          error?: { message?: string }
        }
        if (!response.ok || !body.ok || !body.data) {
          throw new Error(body.error?.message ?? "Error al cargar la galería")
        }
        setImages(body.data.images)
        setTotal(body.data.total)
        setListState("ready")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setListState("error")
      })
    return () => controller.abort()
  }, [reloadToken])

  function reload() {
    setListState("loading")
    setReloadToken((token) => token + 1)
  }

  /**
   * Sube cada imagen elegida al almacenamiento del usuario (kind `attachment`)
   * y conserva su id: el servidor la lee del disco y la manda al proveedor
   * como imagen de referencia.
   */
  async function uploadReferences(added: FileWithPreview[]) {
    await Promise.all(added.map((item) => uploadReference(item)))
  }

  async function uploadReference(item: FileWithPreview) {
    const file = item.file
    if (!(file instanceof File)) return
    const base: ReferenceState = {
      id: item.id,
      serverId: null,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      status: "uploading",
    }
    removedReferenceIds.current.delete(item.id)
    setReferences((current) => ({ ...current, [item.id]: base }))

    const controller = new AbortController()
    uploadControllers.current.set(item.id, controller)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("kind", "attachment")
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: { id: string }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        throw new Error(body.error?.message ?? "No se pudo subir la imagen.")
      }
      // El chip se quitó mientras el archivo subía: ya está en el servidor y
      // hay que liberarlo para no dejarlo huérfano en el disco.
      if (removedReferenceIds.current.has(item.id)) {
        void fetch(`/api/files/${body.data.id}`, { method: "DELETE" }).catch(
          () => {}
        )
        return
      }
      setReferences((current) => ({
        ...current,
        [item.id]: {
          ...(current[item.id] ?? base),
          serverId: body.data!.id,
          status: "ready",
        },
      }))
    } catch (error) {
      if (controller.signal.aborted) return
      setReferences((current) => ({
        ...current,
        [item.id]: { ...(current[item.id] ?? base), status: "error" },
      }))
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo adjuntar la imagen."
      )
    } finally {
      uploadControllers.current.delete(item.id)
    }
  }

  function handleRemoveReference(id: string) {
    const entry = references[id]
    removedReferenceIds.current.add(id)
    uploadControllers.current.get(id)?.abort()
    uploadControllers.current.delete(id)
    removeFile(id)
    setReferences((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    if (entry?.serverId) {
      void fetch(`/api/files/${entry.serverId}`, { method: "DELETE" }).catch(
        () => {}
      )
    }
  }

  const referenceItems: AttachmentItem[] = pickedFiles.flatMap((item) => {
    const entry = references[item.id]
    if (!entry) return []
    return [
      {
        id: entry.id,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes,
        status: entry.status,
      },
    ]
  })

  const referenceIds = referenceItems.flatMap((item) => {
    const entry = references[item.id]
    return entry?.serverId && entry.status === "ready" ? [entry.serverId] : []
  })

  const uploadingReferences = referenceItems.some(
    (item) => item.status === "uploading"
  )

  // Una referencia que no se pudo subir no puede omitirse en silencio: se
  // bloquea el envío hasta que el usuario la quite.
  const failedReferences = referenceItems.some(
    (item) => item.status === "error"
  )

  const referenceBytes = referenceItems.reduce(
    (sum, item) => sum + item.sizeBytes,
    0
  )
  const referencesTooBig = referenceBytes > MAX_REFERENCE_TOTAL_BYTES

  async function generate() {
    const trimmed = prompt.trim()
    if (!trimmed || generating) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          aspectRatio: activeAspect,
          level: selectedLevel?.id,
          referenceIds,
        }),
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: {
          image: ImageGeneration
        }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        setGenerateError(
          body.error?.message ??
            "No se pudo generar la imagen. Inténtalo de nuevo."
        )
        return
      }
      setImages((current) => [body.data!.image, ...current])
      setTotal((current) => current + 1)
      toast.success(
        `Imagen generada · costo ${costLabel(body.data.image)}`
      )
    } catch {
      setGenerateError(
        "No se pudo conectar con el servidor. Inténtalo de nuevo."
      )
    } finally {
      setGenerating(false)
    }
  }

  /**
   * Investiga y reescribe la descripción. `source` fija la base del intento:
   * sin él se parte del texto que hay en el área; con él (lo que hace
   * *Regenerar*) se parte de la descripción original, para que la búsqueda
   * arranque en limpio y no sobre el texto ya expandido.
   */
  async function enhancePrompt(source?: string) {
    const trimmed = (source ?? prompt).trim()
    if (!trimmed || enhancing || generating) return
    setEnhancing(true)
    setGenerateError(null)
    try {
      const response = await fetch("/api/images/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          aspectRatio,
          referenceIds,
        }),
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: {
          prompt: string
          aspectRatio: string
          note?: string | null
          sources?: { title: string; url: string; publishedDate?: string | null }[]
          facts?: {
            value: string
            sources: { title: string; url: string; publishedDate?: string | null }[]
          }[]
        }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        setGenerateError(
          body.error?.message ??
            "No se pudieron insertar los detalles. Inténtalo de nuevo."
        )
        return
      }
      setPrompt(body.data.prompt)
      setAspectRatio(body.data.aspectRatio)
      // La descripción ya está procesada: el botón pasa de *Procesar
      // descripción* a *Generar*.
      setPromptProcessed(true)
      // La base limpia del intento: la descripción del usuario tal como la
      // escribió, para que *Regenerar* pueda repetir la investigación desde
      // el inicio.
      setSourcePrompt(trimmed)
      const sources = body.data.sources ?? []
      const facts = body.data.facts ?? []
      setDetailSources(sources)
      setDetailFacts(facts)
      setDetailNote(body.data.note ?? null)
      toast.success(
        facts.length > 0
          ? `${facts.length} ${facts.length === 1 ? "dato confirmado" : "datos confirmados"} con ${sources.length} ${sources.length === 1 ? "fuente" : "fuentes"}`
          : sources.length > 0
            ? `Detalles insertados desde ${sources.length} ${sources.length === 1 ? "fuente" : "fuentes"}`
            : "Instrucciones actualizadas"
      )
    } catch {
      setGenerateError(
        "No se pudo conectar con el servidor. Inténtalo de nuevo."
      )
    } finally {
      setEnhancing(false)
    }
  }

  /**
   * Deja el prompt en blanco para escribir uno nuevo desde cero: el texto
   * procesado y sus fuentes se van con él. Los adjuntos se conservan (quitarlos
   * es la acción de cada chip).
   */
  function clearPrompt() {
    if (enhancing || generating) return
    applyPromptEdit("")
    setGenerateError(null)
    promptRef.current?.focus()
  }

  /**
   * Copia la descripción completa de la imagen al portapapeles. Antes se
   * mostraba solo un recorte (el prompt íntegro no cabía), así que el texto
   * no se podía leer ni reutilizar tal cual.
   */
  async function copyDescription() {
    const text = viewer?.prompt
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("Descripción copiada al portapapeles.")
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
      copyResetTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("No se pudo copiar la descripción.")
    }
  }

  React.useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    }
  }, [])

  /**
   * Prepara el archivo a compartir en cuanto se abre el visor. Así, al pulsar
   * *Compartir* no hay que esperar la descarga y la Web Share API se puede
   * llamar dentro del gesto del usuario (Safari lo exige).
   */
  React.useEffect(() => {
    const file = viewer?.file
    // Solo se guarda la imagen abierta: el archivo pesa (el WebP y su PNG) y
    // no hace falta llevar más de uno en memoria.
    shareTargets.current.clear()
    if (!file) return
    const controller = new AbortController()
    void fetchShareTarget(file, controller.signal)
      .then((target) => {
        if (controller.signal.aborted) return
        shareTargets.current.set(file.id, target)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [viewer])

  /**
   * Comparte la imagen en su versión baja (la que se está viendo): la Web
   * Share API abre la hoja del sistema y, si el navegador no sabe compartir
   * archivos, la imagen se copia al portapapeles.
   */
  async function shareViewerImage(image: ImageGeneration) {
    const file = image.file
    if (!file || sharing) return
    setSharing(true)
    try {
      const target =
        shareTargets.current.get(file.id) ??
        (await fetchShareTarget(file))
      shareTargets.current.set(file.id, target)
      const outcome = await shareImage(target)
      if (outcome === "copied") {
        toast.success(
          "Imagen copiada al portapapeles. Ya puedes pegarla donde quieras."
        )
      }
    } catch {
      toast.error("No se pudo compartir la imagen.")
    } finally {
      setSharing(false)
    }
  }

  async function remove(image: ImageGeneration) {
    if (deleting) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/images/${image.id}`, {
        method: "DELETE",
      })
      const body = (await response.json()) as { ok: boolean }
      if (!response.ok || !body.ok) {
        toast.error("No se pudo eliminar la imagen.")
        return
      }
      setViewer(null)
      setConfirmDelete(false)
      setZoomed(false)
      toast.success("Imagen eliminada.")
      reload()
    } catch {
      toast.error("No se pudo eliminar la imagen.")
    } finally {
      setDeleting(false)
    }
  }

  const canGenerate =
    prompt.trim().length > 0 &&
    !generating &&
    !dictating &&
    !uploadingReferences &&
    !failedReferences &&
    !referencesTooBig
  const canEnhance =
    prompt.trim().length > 0 &&
    !enhancing &&
    !generating &&
    !dictating &&
    !uploadingReferences &&
    !failedReferences &&
    !referencesTooBig

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
        {/* Barra de pestañas fija: el contenedor se estira de borde a borde
            (márgenes negativos) para que su fondo opaco tape el contenido que
            pasa por debajo, y `top-16` la deja justo bajo la cabecera de la
            app, que es de 4rem. */}
        <div className="sticky top-16 z-10 -mx-4 mb-3.5 bg-background px-4 md:-mx-6 md:px-6">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="generar">Crear</TabsTrigger>
            <TabsTrigger value="galeria">Galería</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="generar" keepMounted>
          <Card>
            <CardHeader>
              <CardTitle>Descripción</CardTitle>
              {/* El micrófono va a la derecha de la etiqueta, a su misma
                  altura: dictar es la otra forma de escribir el prompt.
                  Deshabilitado mientras vuela una investigación o una
                  generación, para que su respuesta no pise el texto dictado. */}
              <CardAction>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant={dictating ? "destructive" : "ghost"}
                        size="icon-sm"
                        onClick={toggleDictation}
                        disabled={enhancing || generating}
                        aria-label={dictation.label}
                        aria-pressed={dictating}
                        aria-disabled={!dictationSupported}
                        className="aria-disabled:opacity-50"
                      />
                    }
                  >
                    <MicIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>{dictation.tooltip}</TooltipContent>
                </Tooltip>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {referenceItems.length > 0 ? (
                <AttachmentChips
                  attachments={referenceItems}
                  onRemove={handleRemoveReference}
                  disabled={generating || enhancing}
                />
              ) : null}
              {/* Bitono: la celda de adjuntos lleva un fondo propio (sin
                  borde: solo cambio de tono) y el símbolo + grande, para que
                  se lea como botón y no como decoración del área de texto; el
                  prompt vive en la zona de la derecha. */}
              <InputGroup className="overflow-hidden bg-background">
                <InputGroupAddon
                  align="inline-start"
                  className="self-stretch bg-muted/50 pl-1 pr-1 has-[>button]:ml-0"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <InputGroupButton
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={openFileDialog}
                          aria-label="Adjuntar imágenes de referencia"
                        />
                      }
                    >
                      <PlusIcon aria-hidden="true" className="size-5" />
                    </TooltipTrigger>
                    <TooltipContent>Adjuntar imágenes de referencia</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
                <InputGroupTextarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(event) => {
                    // Escribir mientras se dicta manda sobre lo dictado: la
                    // sesión se cierra sin guardar lo que se estaba oyendo.
                    if (dictating) {
                      dictationCancelledRef.current = true
                      stopDictation()
                    }
                    applyPromptEdit(event.target.value)
                  }}
                  placeholder="Ejemplo: Crea un póster con el siguiente partido de la selección mexicana de fútbol."
                  rows={3}
                  maxLength={MAX_PROMPT_LENGTH}
                  aria-label="Prompt de la imagen"
                  className="resize-none placeholder:text-foreground/60"
                />
              </InputGroup>
              {/* *Regenerar* repite la investigación desde la descripción
                  original del usuario, no desde el texto ya reescrito: otro
                  intento en limpio cuando la búsqueda no trajo lo esperado.
                  *Limpiar* deja el área en blanco para escribir un prompt
                  nuevo desde cero. Los dos van juntos, a la derecha. */}
              {sourcePrompt || prompt.trim() ? (
                <div className="flex justify-end gap-2">
                  {sourcePrompt ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void enhancePrompt(sourcePrompt)}
                      disabled={enhancing || generating}
                      title="Repite la investigación desde tu descripción original, sin partir del texto ya reescrito"
                    >
                      {enhancing ? (
                        <Spinner />
                      ) : (
                        <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                      )}
                      Regenerar
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearPrompt}
                    disabled={enhancing || generating}
                    title="Borra la descripción para escribir un prompt nuevo desde cero"
                  >
                    <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                    Limpiar
                  </Button>
                </div>
              ) : null}
              {dictating ? (
                <p
                  role="status"
                  className="text-muted-foreground flex items-center gap-2 text-xs"
                >
                  <span
                    aria-hidden="true"
                    className="bg-destructive size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                  />
                  {dictation.status}
                </p>
              ) : null}
              {prompt.length >= MAX_PROMPT_LENGTH ? (
                <p
                  role="status"
                  className="text-muted-foreground text-xs"
                >
                  Límite de {MAX_PROMPT_LENGTH} caracteres alcanzado: lo que
                  sigas dictando o escribiendo no se agrega.
                </p>
              ) : null}
              {detailNote ? (
                <p className="text-muted-foreground text-xs">{detailNote}</p>
              ) : null}
              {detailFacts.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-xs">
                    Datos confirmados (cada uno con al menos dos fuentes
                    independientes):
                  </p>
                  <ul className="flex flex-col gap-1">
                    {detailFacts.map((fact, index) => (
                      <li
                        key={`${index}-${fact.value}`}
                        className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
                      >
                        <CheckIcon
                          className="size-3.5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span>{fact.value}</span>
                        <span className="text-muted-foreground">
                          {fact.sources.map((source, sourceIndex) => (
                            <span key={source.url}>
                              {sourceIndex > 0 ? " · " : "— "}
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline underline-offset-2 hover:text-foreground"
                              >
                                {domainLabel(source.url)}
                              </a>
                              {sourceDateLabel(source.publishedDate)
                                ? ` (${sourceDateLabel(source.publishedDate)})`
                                : ""}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : detailSources.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Investigué {detailSources.length}{" "}
                  {detailSources.length === 1 ? "fuente" : "fuentes"}:{" "}
                  {detailSources.slice(0, 3).map((source, index) => (
                    <span key={source.url}>
                      {index > 0 ? " · " : ""}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {source.title.length > 60
                          ? `${source.title.slice(0, 60)}…`
                          : source.title}
                      </a>
                    </span>
                  ))}
                  {detailSources.length > 3
                    ? ` · +${detailSources.length - 3} más`
                    : null}
                </p>
              ) : null}
              <input
                {...getInputProps()}
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
              />
              {referenceError ? (
                <p role="alert" className="text-destructive text-xs">
                  {referenceError}
                </p>
              ) : null}
              {referencesTooBig ? (
                <p role="alert" className="text-destructive text-xs">
                  Las imágenes de referencia suman {formatBytes(referenceBytes)};
                  el máximo por generación es{" "}
                  {formatBytes(MAX_REFERENCE_TOTAL_BYTES)}.
                </p>
              ) : null}
              {failedReferences ? (
                <p role="alert" className="text-destructive text-xs">
                  Hay una imagen de referencia que no se pudo subir. Quítala
                  para continuar.
                </p>
              ) : null}
              {/* Renglón compacto: en móvil *Formato* y *Calidad* comparten
                  fila (el select toma el ancho restante y los toggles el suyo)
                  y el botón queda debajo a todo el ancho; en ≥lg es la fila
                  alineada de tres columnas de siempre. */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 lg:grid-cols-[12rem_auto_1fr] lg:gap-x-4 lg:gap-y-1.5">
                <div className="flex flex-col gap-1 lg:contents">
                  <Label
                    htmlFor="aspecto"
                    className="text-muted-foreground text-xs lg:col-start-1 lg:row-start-1"
                  >
                    Formato
                  </Label>
                  <Select
                    value={activeAspect}
                    // Con `items`, el trigger muestra la etiqueta de la
                    // opción elegida ("9:16 · Póster") y no el valor crudo.
                    items={aspectOptions}
                    onValueChange={(value) => setAspectRatio(value as string)}
                  >
                    <SelectTrigger
                      id="aspecto"
                      className="w-full lg:col-start-1 lg:row-start-2"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {aspectOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {activeAspect === "auto" ? (
                    <p className="text-muted-foreground text-xs lg:col-start-1 lg:row-start-3 lg:self-center">
                      Tamaño: {selectedLevel?.entry.size ?? "—"}
                    </p>
                  ) : null}
                </div>
                {levels.length > 1 ? (
                  <div className="flex flex-col gap-1 lg:contents">
                    <Label
                      id="imagenes-calidad"
                      className="text-muted-foreground text-xs lg:col-start-2 lg:row-start-1"
                    >
                      Calidad
                    </Label>
                    <ToggleGroup
                      variant="default"
                      aria-labelledby="imagenes-calidad"
                      className="lg:col-start-2 lg:row-start-2"
                      value={[levels[activeQualityIndex].id]}
                      disabled={generating || enhancing}
                      onValueChange={(value) => {
                        const next = value[value.length - 1]
                        const index = levels.findIndex(
                          (level) => level.id === next
                        )
                        if (index >= 0) setQualityIndex(index)
                      }}
                    >
                      {levels.map((level) => (
                        <ToggleGroupItem
                          key={level.id}
                          value={level.id}
                        >
                          {level.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                ) : null}
                <div className="col-span-2 flex flex-col gap-2 lg:col-span-1 lg:col-start-3 lg:row-start-2 lg:items-end">
                  {/* Pista de progreso del flujo (stepper ReUI en modo display:
                      ítems deshabilitados y valor controlado, patrón tracking).
                      El avance real lo marca el botón; los círculos solo hacen
                      evidente en qué paso está el flujo sin leer la etiqueta. */}
                  <Stepper
                    value={promptProcessed ? 2 : 1}
                    className="max-w-56 self-center lg:self-end"
                    aria-label="Progreso de la generación"
                    indicators={{ loading: <Spinner className="size-3.5" /> }}
                  >
                    <StepperNav>
                      <StepperItem step={1} disabled loading={enhancing}>
                        <StepperTrigger>
                          <StepperIndicator>1</StepperIndicator>
                        </StepperTrigger>
                        <StepperSeparator />
                      </StepperItem>
                      <StepperItem step={2} disabled loading={generating}>
                        <StepperTrigger>
                          <StepperIndicator>2</StepperIndicator>
                        </StepperTrigger>
                      </StepperItem>
                    </StepperNav>
                  </Stepper>
                  <span className="sr-only">
                    {promptProcessed
                      ? "Paso 2 de 2: crear la imagen"
                      : "Paso 1 de 2: investigar y mejorar la descripción"}
                  </span>
                  {/* Un solo botón, dos pasos: primero *Investigar y mejorar
                      descripción* (investiga y reescribe el prompt) y, cuando
                      el texto ya está procesado, el mismo botón pasa a
                      *Crear*. */}
                  <Button
                    className="w-full sm:w-auto sm:self-center lg:self-end"
                    onClick={() =>
                      promptProcessed ? void generate() : void enhancePrompt()
                    }
                    disabled={promptProcessed ? !canGenerate : !canEnhance}
                    title={
                      promptProcessed
                        ? undefined
                        : "El modelo investiga en internet, confirma cada dato con al menos dos fuentes independientes y los añade a la descripción"
                    }
                  >
                    {enhancing || generating ? (
                      <Spinner />
                    ) : promptProcessed ? (
                      <SparklesIcon data-icon="inline-start" />
                    ) : (
                      <SearchIcon data-icon="inline-start" />
                    )}
                    {enhancing
                      ? "Investigando…"
                      : generating
                        ? "Creando…"
                        : promptProcessed
                          ? "Crear"
                          : "Investigar y mejorar descripción"}
                  </Button>
                  {/* Atajo discreto para quien no necesita investigación
                      (prompts imaginativos): genera con el texto tal cual.
                      Solo aparece con texto escrito y sin procesar, para no
                      competir con la acción principal. Mientras se dicta no
                      aparece: el texto todavía está en camino. */}
                  {!promptProcessed && !dictating && prompt.trim().length > 0 ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="self-center lg:self-end"
                      onClick={() => void generate()}
                      disabled={!canGenerate || enhancing}
                      title="Genera directamente con el texto tal como está, sin investigarlo antes"
                    >
                      Crear sin investigar
                    </Button>
                  ) : null}
                </div>
              </div>
              {generateError ? (
                <p
                  role="alert"
                  className="text-destructive text-sm transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
                >
                  {generateError}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="galeria" keepMounted>
          <section
            aria-labelledby="galeria-titulo"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="galeria-titulo"
                  className="text-sm font-semibold tracking-tight"
                >
                  Galería
                </h2>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {listState === "loading" ? "Cargando…" : `${total} imágenes`}
                </p>
              </div>
            </div>

            {listState === "loading" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="aspect-square w-full rounded-xl" />
                ))}
              </div>
            ) : null}

            {listState === "error" ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
                <p className="text-muted-foreground text-sm">
                  No pudimos cargar tu galería.
                </p>
                <Button variant="outline" size="sm" onClick={reload}>
                  Reintentar
                </Button>
              </div>
            ) : null}

            {listState === "ready" && images.length === 0 ? (
              <Empty className="rounded-xl border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ImageIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>Aún no hay imágenes</EmptyTitle>
                  <EmptyDescription>
                    Genera tu primera imagen y aparecerá aquí automáticamente, con
                    su costo registrado.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTab("generar")
                      requestAnimationFrame(() =>
                        promptRef.current?.focus()
                      )
                    }}
                  >
                    Escribir prompt
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}

            {listState === "ready" && images.length > 0 ? (
              <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {generating ? (
                  <Skeleton className="aspect-square w-full rounded-xl" />
                ) : null}
                {images.map((image) =>
                  image.file ? (
                    <figure
                      key={image.id}
                      className="group relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCopied(false)
                          setViewer(image)
                        }}
                        className="block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={`Ver imagen generada el ${dateFormatter.format(new Date(image.createdAt))}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía */}
                        <img
                          src={thumbSource(image.file)}
                          alt={image.prompt}
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          // La miniatura respeta la proporción de la imagen: un
                          // recorte al cuadrado escondería (por ejemplo) una
                          // vertical 9:16.
                          style={aspectStyle(
                            image.aspectRatio,
                            image.file.variants?.thumb
                          )}
                          // El toque no debe caer en la imagen: en móvil el
                          // navegador abre su visor nativo a pantalla
                          // completa. Lo captura el botón de arriba.
                          className="pointer-events-none w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
                          onError={fallbackToOriginal(image.file.url)}
                        />
                      </button>
                      <figcaption className="flex items-center justify-between gap-2 px-2.5 py-2">
                        <span className="text-muted-foreground truncate text-xs">
                          {dateFormatter.format(new Date(image.createdAt))}
                        </span>
                        <Badge
                          variant="success-light"
                          size="sm"
                          radius="full"
                          className="tabular-nums"
                          aria-label={`Costo: ${costLabel(image)}`}
                          title={
                            image.costMxn !== null
                              ? "Costo de esta imagen en pesos, al TC FIX del día de generación"
                              : "Costo de esta imagen en USD, TC no disponible"
                          }
                        >
                          {costLabel(image)}
                        </Badge>
                      </figcaption>
                    </figure>
                  ) : null
                )}
              </div>
            ) : null}
          </section>
        </TabsContent>
      </Tabs>

      <Dialog
        open={viewer !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewer(null)
            setConfirmDelete(false)
            setCopied(false)
            setZoomed(false)
          }
        }}
      >
        <DialogContent
          className="touch-manipulation sm:max-w-2xl"
          showCloseButton={false}
        >
          <ViewerCloseButton />
          {/* El visor no lleva título visible: el nombre accesible se queda
              solo para lectores de pantalla. */}
          <DialogTitle className="sr-only">Imagen generada</DialogTitle>
          {viewer && viewer.file ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg bg-muted">
                <button
                  type="button"
                  onClick={() => setZoomed(true)}
                  className="block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label="Ver la imagen a pantalla completa"
                  title="Ver a pantalla completa"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía */}
                  <img
                    src={lowSource(viewer.file)}
                    alt={viewer.prompt}
                    decoding="async"
                    draggable={false}
                    // Igual que en la galería: el `<img>` no es el destino del
                    // toque para que el móvil no abra su visor nativo; lo
                    // captura este botón, que abre la pantalla completa.
                    className="pointer-events-none max-h-[60vh] w-full object-contain"
                    onError={fallbackToOriginal(viewer.file.url)}
                  />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="success-light"
                  className="tabular-nums"
                  aria-label={`Costo: ${costLabel(viewer)}`}
                  title={
                    viewer.costMxn !== null
                      ? "Costo de esta imagen en pesos, al TC FIX del día de generación"
                      : "Costo de esta imagen en USD, TC no disponible"
                  }
                >
                  {costLabel(viewer)}
                </Badge>
                <Badge variant="outline">
                  {viewer.aspectRatio ?? "auto"}
                </Badge>
                <Badge variant="outline">{viewer.quality ?? "auto"}</Badge>
                {/* La fecha (sin hora) en el mismo renglón de los datos, pegada
                    al margen derecho. */}
                <span className="text-muted-foreground ml-auto text-xs">
                  {dayFormatter.format(new Date(viewer.createdAt))}
                </span>
              </div>
              {/* Acciones sobre la imagen. Eliminar queda aparte de la acción
                  principal (descargar) y pide confirmación. */}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyDescription()}
                  title="Copia la descripción completa de la imagen al portapapeles para poder reusarla"
                >
                  {copied ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  {copied ? "Copiado" : "Copiar descripción"}
                </Button>
                <AlertDialog
                  open={confirmDelete}
                  onOpenChange={setConfirmDelete}
                >
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title="Borra la imagen de tu galería y de tu almacenamiento"
                      />
                    }
                  >
                    <Trash2Icon data-icon="inline-start" />
                    Eliminar
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogMedia>
                        <Trash2Icon aria-hidden="true" />
                      </AlertDialogMedia>
                      <AlertDialogTitle>
                        ¿Eliminar esta imagen?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Se borrará de tu galería y de tu carpeta de
                        almacenamiento. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel size="sm">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        size="sm"
                        disabled={deleting}
                        onClick={() => void remove(viewer)}
                      >
                        {deleting ? <Spinner className="size-3.5" /> : null}
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {viewer && viewer.file ? (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void shareViewerImage(viewer)}
                  disabled={sharing}
                  title="Comparte la versión reducida en WebP (1280 px) con WhatsApp, Telegram o cualquier otra app"
                >
                  {sharing ? (
                    <Spinner className="size-3.5" data-icon="inline-start" />
                  ) : (
                    <Share2Icon data-icon="inline-start" />
                  )}
                  Compartir
                </Button>
                <Button
                  size="sm"
                  title="Archivo original tal como lo generó el modelo"
                  render={
                    <a
                      href={downloadUrl(viewer.file.url)}
                      download={viewer.file.fileName}
                    />
                  }
                >
                  <ImageDownIcon data-icon="inline-start" />
                  Descargar original
                </Button>
              </div>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pantalla completa: solo la imagen, sobre el visor. Toque en cualquier
          parte, Escape o la X para volver. */}
      {viewer && viewer.file ? (
        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent
            className="touch-manipulation inset-0 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-black p-0 text-white ring-0 sm:max-w-none"
            showCloseButton={false}
            onClick={() => setZoomed(false)}
          >
            <ViewerCloseButton />
            <DialogTitle className="sr-only">
              Imagen a pantalla completa
            </DialogTitle>
            <DialogDescription className="sr-only">
              Toca la imagen o presiona Escape para volver al visor.
            </DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía */}
            <img
              src={lowSource(viewer.file)}
              alt={viewer.prompt}
              decoding="async"
              draggable={false}
              className="pointer-events-none h-dvh w-full object-contain"
              onError={fallbackToOriginal(viewer.file.url)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
