"use client"

import * as React from "react"
import {
  DownloadIcon,
  ImageIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

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
import { Textarea } from "@/components/ui/textarea"

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

const MAX_PROMPT_LENGTH = 2000

const ASPECT_OPTIONS = [
  { value: "auto", label: "Automático" },
  { value: "1:1", label: "1:1 · Cuadrada" },
  { value: "16:9", label: "16:9 · Panorámica" },
  { value: "9:16", label: "9:16 · Vertical" },
  { value: "4:3", label: "4:3 · Clásica" },
  { value: "3:4", label: "3:4 · Retrato" },
  { value: "3:2", label: "3:2 · Foto" },
  { value: "2:3", label: "2:3 · Foto vertical" },
] as const

const QUALITY_OPTIONS = [
  { value: "auto", label: "Automática" },
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
] as const

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

export function ImageStudio() {
  const [images, setImages] = React.useState<ImageGeneration[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalCostUsd, setTotalCostUsd] = React.useState(0)
  const [totalCostMxn, setTotalCostMxn] = React.useState<number | null>(null)
  const [listState, setListState] = React.useState<ListState>("loading")

  const [prompt, setPrompt] = React.useState("")
  const [aspectRatio, setAspectRatio] = React.useState<string>("auto")
  const [quality, setQuality] = React.useState<string>("auto")
  const [generating, setGenerating] = React.useState(false)
  const [enhancing, setEnhancing] = React.useState(false)
  const [generateError, setGenerateError] = React.useState<string | null>(null)

  const [viewer, setViewer] = React.useState<ImageGeneration | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const [reloadToken, setReloadToken] = React.useState(0)

  const promptRef = React.useRef<HTMLTextAreaElement>(null)

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

  async function generate() {
    const trimmed = prompt.trim()
    if (!trimmed || generating) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, aspectRatio, quality }),
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
        body: JSON.stringify({ prompt: trimmed, aspectRatio, quality }),
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: { prompt: string; aspectRatio: string; quality: string }
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
      setQuality(body.data.quality)
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

  const canGenerate = prompt.trim().length > 0 && !generating
  const canEnhance = prompt.trim().length > 0 && !enhancing && !generating

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Generar imagen</CardTitle>
          <CardDescription>
            Describe la imagen que quieres crear; se guarda en tu galería y en
            tu carpeta de almacenamiento.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ej.: un ajolote astronauta flotando entre nebulosas, iluminación de estudio, estilo fotográfico"
            rows={3}
            maxLength={MAX_PROMPT_LENGTH}
            aria-label="Prompt de la imagen"
            className="resize-none"
          />
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-36 flex-col gap-1">
              <Label htmlFor="aspecto" className="text-xs">
                Aspecto
              </Label>
              <Select
                value={aspectRatio}
                onValueChange={(value) => setAspectRatio(value as string)}
              >
                <SelectTrigger id="aspecto" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-36 flex-col gap-1">
              <Label htmlFor="calidad" className="text-xs">
                Calidad
              </Label>
              <Select
                value={quality}
                onValueChange={(value) => setQuality(value as string)}
              >
                <SelectTrigger id="calidad" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

      <section aria-labelledby="galeria-titulo" className="flex flex-col gap-3">
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
                onClick={() => promptRef.current?.focus()}
              >
                Escribir prompt
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {listState === "ready" && images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                      className="aspect-square w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
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
