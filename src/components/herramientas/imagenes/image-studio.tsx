"use client"

import * as React from "react"
import {
  DownloadIcon,
  ImageIcon,
  PaperclipIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TOTAL_BYTES,
  REFERENCE_IMAGE_TYPES,
} from "@/lib/attachments"

import { Badge } from "@/components/reui/badge"
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
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

interface ImageFile {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
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

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
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

function modelName(model: string): string {
  return model.split("/").pop() ?? model
}

/**
 * Proporción CSS de la miniatura a partir del aspecto con el que se generó
 * la imagen ("9:16" → "9 / 16"). Sin aspecto conocido, la imagen se muestra
 * con su tamaño natural.
 */
function aspectStyle(aspect: string | null): React.CSSProperties | undefined {
  if (!aspect || aspect === "auto") return undefined
  const [width, height] = aspect.split(":")
  if (!width || !height) return undefined
  return { aspectRatio: `${width} / ${height}` }
}

type ImageStudioProps = {
  /** Niveles del control de calidad (modelo por nivel) del usuario. */
  levels: readonly ImageLevel[]
}

export function ImageStudio({ levels }: ImageStudioProps = { levels: [] }) {
  const [images, setImages] = React.useState<ImageGeneration[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalCostUsd, setTotalCostUsd] = React.useState(0)
  const [totalCostMxn, setTotalCostMxn] = React.useState<number | null>(null)
  const [listState, setListState] = React.useState<ListState>("loading")

  const [prompt, setPrompt] = React.useState("")
  const [aspectRatio, setAspectRatio] = React.useState<string>("auto")
  // El nivel (media/alta) es lo que elige el usuario; cada nivel trae el
  // modelo, la calidad y el tamaño configurados en Configuración.
  const [qualityIndex, setQualityIndex] = React.useState(0)
  const [generating, setGenerating] = React.useState(false)
  const [enhancing, setEnhancing] = React.useState(false)
  const [generateError, setGenerateError] = React.useState<string | null>(null)

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

  // Tamaño efectivo de la generación: el aspecto elegido manda; si es
  // "Automático", manda el tamaño configurado para el nivel.
  const effectiveSize =
    aspectOptions.find((option) => option.value === activeAspect)?.label ??
    selectedLevel?.entry.size ??
    ""

  const [references, setReferences] = React.useState<Record<string, ReferenceState>>({})
  const [referenceError, setReferenceError] = React.useState<string | null>(null)
  // Subidas en vuelo: al quitar un chip se aborta la suya para no dejar el
  // archivo huérfano en el disco.
  const uploadControllers = React.useRef(new Map<string, AbortController>())
  const removedReferenceIds = React.useRef(new Set<string>())

  const [viewer, setViewer] = React.useState<ImageGeneration | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const [tab, setTab] = React.useState("generar")

  const [reloadToken, setReloadToken] = React.useState(0)

  const promptRef = React.useRef<HTMLTextAreaElement>(null)

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
            totalCostUsd: number
            totalCostMxn: number | null
          }
          error?: { message?: string }
        }
        if (!response.ok || !body.ok || !body.data) {
          throw new Error(body.error?.message ?? "Error al cargar la galería")
        }
        setImages(body.data.images)
        setTotal(body.data.total)
        setTotalCostUsd(body.data.totalCostUsd)
        setTotalCostMxn(body.data.totalCostMxn)
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
          totalCostUsd: number
          totalCostMxn: number | null
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
      setTotalCostUsd(body.data.totalCostUsd)
      setTotalCostMxn(body.data.totalCostMxn)
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

  async function enhancePrompt() {
    const trimmed = prompt.trim()
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
        data?: { prompt: string; aspectRatio: string }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        setGenerateError(
          body.error?.message ??
            "No se pudieron mejorar las instrucciones. Inténtalo de nuevo."
        )
        return
      }
      setPrompt(body.data.prompt)
      setAspectRatio(body.data.aspectRatio)
      toast.success("Instrucciones mejoradas")
    } catch {
      setGenerateError(
        "No se pudo conectar con el servidor. Inténtalo de nuevo."
      )
    } finally {
      setEnhancing(false)
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
    !uploadingReferences &&
    !failedReferences &&
    !referencesTooBig
  const canEnhance =
    prompt.trim().length > 0 &&
    !enhancing &&
    !generating &&
    !uploadingReferences &&
    !failedReferences &&
    !referencesTooBig

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
        <TabsList variant="line" className="mb-3.5 w-full">
          <TabsTrigger value="generar">Generar</TabsTrigger>
          <TabsTrigger value="galeria">Galería</TabsTrigger>
        </TabsList>

        <TabsContent value="generar" keepMounted>
          <Card>
            <CardHeader>
              <CardTitle>Generar imagen</CardTitle>
              <CardDescription>
                Describe la imagen que quieres crear; se guarda en tu galería y en
                tu carpeta de almacenamiento.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {referenceItems.length > 0 ? (
                <AttachmentChips
                  attachments={referenceItems}
                  onRemove={handleRemoveReference}
                  disabled={generating || enhancing}
                />
              ) : null}
              <InputGroup className="bg-background">
                <InputGroupAddon align="inline-start">
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
                      <PaperclipIcon aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>Adjuntar imágenes de referencia</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
                <InputGroupTextarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ej.: un ajolote astronauta flotando entre nebulosas, iluminación de estudio, estilo fotográfico"
                  rows={3}
                  maxLength={MAX_PROMPT_LENGTH}
                  aria-label="Prompt de la imagen"
                  className="resize-none placeholder:text-foreground/60"
                />
              </InputGroup>
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
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-36 flex-col gap-1">
                  <Label htmlFor="aspecto" className="text-xs">
                    Aspecto
                  </Label>
                  <Select
                    value={activeAspect}
                    onValueChange={(value) => setAspectRatio(value as string)}
                  >
                    <SelectTrigger id="aspecto" size="sm" className="w-full">
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
                  <p className="text-muted-foreground text-xs">
                    {activeAspect === "auto"
                      ? `Tamaño: ${selectedLevel?.entry.size ?? "—"}`
                      : effectiveSize}
                  </p>
                </div>
                {levels.length > 1 ? (
                  <div className="flex min-w-40 flex-col gap-1">
                    <Label
                      id="imagenes-calidad"
                      className="text-muted-foreground text-xs"
                    >
                      Calidad
                      <span className="sr-only">
                        : {levels[activeQualityIndex].label}
                      </span>
                    </Label>
                    <Slider
                      aria-labelledby="imagenes-calidad"
                      value={[activeQualityIndex + 1]}
                      min={1}
                      max={levels.length}
                      step={1}
                      disabled={generating || enhancing}
                      onValueChange={(value) => {
                        const next = Array.isArray(value)
                          ? value[value.length - 1]
                          : value
                        if (typeof next === "number") setQualityIndex(next - 1)
                      }}
                    />
                    <div
                      aria-hidden="true"
                      className="text-muted-foreground flex w-full items-center justify-between text-xs font-medium"
                    >
                      {levels.map((level, index) => (
                        <span
                          key={level.id}
                          className={
                            index === activeQualityIndex
                              ? "text-foreground"
                              : undefined
                          }
                        >
                          {level.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="ms-auto flex items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void enhancePrompt()}
                    disabled={!canEnhance}
                    title="El modelo revisa tu descripción, la hace más concreta y ajusta el aspecto si es ambiguo"
                  >
                    {enhancing ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <WandSparklesIcon
                        data-icon="inline-start"
                        className="size-3.5"
                      />
                    )}
                    {enhancing ? "Revisando…" : "Mejorar instrucciones"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void generate()}
                    disabled={!canGenerate}
                  >
                    {generating ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <SparklesIcon data-icon="inline-start" className="size-3.5" />
                    )}
                    {generating ? "Generando…" : "Generar"}
                  </Button>
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
            <div className="flex flex-wrap items-end justify-between gap-3">
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
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-muted-foreground text-xs">
                  Costo acumulado
                </span>
                {listState === "loading" ? (
                  <Skeleton className="h-5 w-20" />
                ) : (
                  <span className="text-base font-semibold tabular-nums">
                    {totalCostMxn !== null
                      ? mxn(totalCostMxn)
                      : `US$${totalCostUsd.toFixed(4)}`}
                  </span>
                )}
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
                        onClick={() => setViewer(image)}
                        className="block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={`Ver imagen generada el ${dateFormatter.format(new Date(image.createdAt))}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía */}
                        <img
                          src={image.file.url}
                          alt={image.prompt}
                          loading="lazy"
                          // La miniatura respeta la proporción de la imagen: un
                          // recorte al cuadrado escondería (por ejemplo) una
                          // vertical 9:16.
                          style={aspectStyle(image.aspectRatio)}
                          className="w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
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
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Imagen generada</DialogTitle>
            <DialogDescription>
              {viewer
                ? dateFormatter.format(new Date(viewer.createdAt))
                : null}
            </DialogDescription>
          </DialogHeader>
          {viewer && viewer.file ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía */}
                <img
                  src={viewer.file.url}
                  alt={viewer.prompt}
                  className="max-h-[60vh] w-full object-contain"
                />
              </div>
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {viewer.prompt}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success-light" className="tabular-nums">
                  Costo: {costLabel(viewer)}
                </Badge>
                <Badge variant="outline">
                  {viewer.aspectRatio ?? "auto"}
                </Badge>
                <Badge variant="outline">{viewer.quality ?? "auto"}</Badge>
                <span className="text-muted-foreground ms-auto truncate text-xs">
                  {modelName(viewer.model)}
                </span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {viewer && viewer.file ? (
              <>
                <Button variant="outline" size="sm" render={
                  <a
                    href={`${viewer.file.url}?download=1`}
                    download={viewer.file.fileName}
                  />
                }>
                  <DownloadIcon data-icon="inline-start" className="size-3.5" />
                  Descargar
                </Button>
                <AlertDialog
                  open={confirmDelete}
                  onOpenChange={setConfirmDelete}
                >
                  <AlertDialogTrigger
                    render={<Button variant="destructive" size="sm" />}
                  >
                    <Trash2Icon data-icon="inline-start" className="size-3.5" />
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
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
