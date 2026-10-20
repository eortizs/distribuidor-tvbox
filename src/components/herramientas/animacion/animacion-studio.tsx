"use client"

import * as React from "react"
import {
  ClockIcon,
  DownloadIcon,
  FileAudioIcon,
  FileTextIcon,
  FilmIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { AnimacionAgent } from "@/components/herramientas/animacion/animacion-agent"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDurationMs } from "@/lib/duration"

interface AnimationDeliverable {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
  sessionId: string
  turnId: string | null
  costUsd: number | null
  costMxn: number | null
  timeMs: number | null
  createdAt: string
}

type ListState = "loading" | "ready" | "error"

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

function costLabel(item: AnimationDeliverable): string {
  if (item.costMxn !== null) return mxn(item.costMxn)
  return item.costUsd === null ? "s/d" : `US$${item.costUsd.toFixed(4)}`
}

function timeLabel(item: AnimationDeliverable): string {
  return item.timeMs === null ? "s/t" : formatDurationMs(item.timeMs)
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/")
}

function isAudio(mimeType: string): boolean {
  return mimeType.startsWith("audio/")
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

export function AnimacionStudio() {
  const [deliverables, setDeliverables] = React.useState<
    AnimationDeliverable[]
  >([])
  const [total, setTotal] = React.useState(0)
  const [totalCostUsd, setTotalCostUsd] = React.useState(0)
  const [totalCostMxn, setTotalCostMxn] = React.useState<number | null>(null)
  const [totalTimeMs, setTotalTimeMs] = React.useState(0)
  const [listState, setListState] = React.useState<ListState>("loading")

  const [tab, setTab] = React.useState("agente")
  const [viewer, setViewer] = React.useState<AnimationDeliverable | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  // `reload` shows skeletons; `refresh` updates in place (tab switch, turn
  // settled, after delete). Both bump a token that the fetch effect consumes.
  const showErrorsRef = React.useRef(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const reload = React.useCallback(() => {
    showErrorsRef.current = true
    setListState("loading")
    setReloadToken((token) => token + 1)
  }, [])

  const refresh = React.useCallback(() => {
    showErrorsRef.current = false
    setReloadToken((token) => token + 1)
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/animaciones", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          ok: boolean
          data?: {
            animations: AnimationDeliverable[]
            total: number
            totalCostUsd: number
            totalCostMxn: number | null
            totalTimeMs: number
          }
          error?: { message?: string }
        }
        if (!response.ok || !body.ok || !body.data) {
          throw new Error(body.error?.message ?? "Error al cargar la galería")
        }
        setDeliverables(body.data.animations)
        setTotal(body.data.total)
        setTotalCostUsd(body.data.totalCostUsd)
        setTotalCostMxn(body.data.totalCostMxn)
        setTotalTimeMs(body.data.totalTimeMs)
        setListState("ready")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (showErrorsRef.current) setListState("error")
      })
    return () => controller.abort()
  }, [reloadToken])

  async function remove(item: AnimationDeliverable) {
    if (deleting) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/animaciones/${item.id}`, {
        method: "DELETE",
      })
      const body = (await response.json()) as { ok: boolean }
      if (!response.ok || !body.ok) {
        toast.error("No se pudo eliminar el entregable.")
        return
      }
      setViewer(null)
      setConfirmDelete(false)
      toast.success("Entregable eliminado.")
      refresh()
    } catch {
      toast.error("No se pudo eliminar el entregable.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = value as string
        setTab(next)
        if (next === "galeria") refresh()
      }}
      className="min-h-0 flex-1"
    >
      <TabsList variant="line" className="mb-3.5 w-full shrink-0">
        <TabsTrigger value="agente">Agente</TabsTrigger>
        <TabsTrigger value="galeria">Galería</TabsTrigger>
      </TabsList>

      <TabsContent value="agente" keepMounted className="flex min-h-0 flex-col">
        <AnimacionAgent onTurnSettled={refresh} />
      </TabsContent>

      <TabsContent value="galeria" keepMounted className="min-h-0 overflow-y-auto">
        <section
          aria-labelledby="galeria-animacion-titulo"
          className="flex flex-col gap-3 pb-2"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h2
                id="galeria-animacion-titulo"
                className="text-sm font-semibold tracking-tight"
              >
                Galería
              </h2>
              <p className="text-muted-foreground text-xs tabular-nums">
                {listState === "loading"
                  ? "Cargando…"
                  : `${total} ${
                      total === 1 ? "entregable" : "entregables"
                    }`}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-6">
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
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-muted-foreground text-xs">
                  Tiempo total
                </span>
                {listState === "loading" ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
                    <ClockIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-4"
                    />
                    {formatDurationMs(totalTimeMs)}
                  </span>
                )}
              </div>
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

          {listState === "ready" && deliverables.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FilmIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Aún no hay entregables</EmptyTitle>
                <EmptyDescription>
                  Pide tu primera animación; cada video, audio o imagen que
                  produzca el agente aparecerá aquí con su costo en pesos y su
                  tiempo de trabajo.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTab("agente")}
                >
                  Pedir una animación
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {listState === "ready" && deliverables.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {deliverables.map((item) => (
                <figure
                  key={item.id}
                  className="group relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10"
                >
                  <button
                    type="button"
                    onClick={() => setViewer(item)}
                    className="block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={`Ver ${item.fileName} entregado el ${dateFormatter.format(new Date(item.createdAt))}`}
                  >
                    {isVideo(item.mimeType) ? (
                      <video
                        src={item.url}
                        preload="metadata"
                        muted
                        playsInline
                        className="pointer-events-none aspect-square w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
                      />
                    ) : isAudio(item.mimeType) ? (
                      <div className="flex aspect-square w-full items-center justify-center">
                        <FileAudioIcon
                          aria-hidden="true"
                          className="text-muted-foreground size-10"
                        />
                      </div>
                    ) : isImage(item.mimeType) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía
                      <img
                        src={item.url}
                        alt={item.fileName}
                        loading="lazy"
                        className="aspect-square w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center">
                        <FileTextIcon
                          aria-hidden="true"
                          className="text-muted-foreground size-10"
                        />
                      </div>
                    )}
                  </button>
                  <figcaption className="flex flex-col gap-1 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground truncate text-xs">
                        {dateFormatter.format(new Date(item.createdAt))}
                      </span>
                      <Badge
                        variant="success-light"
                        size="sm"
                        radius="full"
                        className="tabular-nums"
                        title={
                          item.costMxn !== null
                            ? "Costo acumulado de la conversación que produjo este entregable, al TC FIX del día"
                            : "Costo de la conversación en USD, TC no disponible"
                        }
                      >
                        {costLabel(item)}
                      </Badge>
                    </div>
                    <span
                      className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums"
                      title="Tiempo de trabajo del agente en la conversación que produjo este entregable"
                    >
                      <ClockIcon aria-hidden="true" className="size-3" />
                      {timeLabel(item)}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </section>
      </TabsContent>

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
            <DialogTitle>Entregable</DialogTitle>
            <DialogDescription>
              {viewer ? dateFormatter.format(new Date(viewer.createdAt)) : null}
            </DialogDescription>
          </DialogHeader>
          {viewer ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg bg-muted">
                {isVideo(viewer.mimeType) ? (
                  <video
                    src={viewer.url}
                    controls
                    preload="metadata"
                    className="max-h-[60vh] w-full bg-black"
                  />
                ) : isAudio(viewer.mimeType) ? (
                  <div className="flex flex-col items-center gap-4 p-8">
                    <FileAudioIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-10"
                    />
                    <audio src={viewer.url} controls className="w-full" />
                  </div>
                ) : isImage(viewer.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- /api/files requiere la cookie de sesión; el optimizador de next/image no la envía
                  <img
                    src={viewer.url}
                    alt={viewer.fileName}
                    className="max-h-[60vh] w-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center p-12">
                    <FileTextIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-10"
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success-light" className="tabular-nums">
                  Costo: {costLabel(viewer)}
                </Badge>
                <span className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums">
                  <ClockIcon aria-hidden="true" className="size-3" />
                  Tiempo: {timeLabel(viewer)}
                </span>
                <span className="text-muted-foreground ms-auto truncate text-xs">
                  {viewer.fileName} · {formatSize(viewer.sizeBytes)}
                </span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {viewer ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <a
                      href={`${viewer.url}?download=1`}
                      download={viewer.fileName}
                    />
                  }
                >
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
                        ¿Eliminar este entregable?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Se borrará de tu galería y de tu carpeta de
                        almacenamiento. Su costo y tiempo permanecen en los
                        acumulados. Esta acción no se puede deshacer.
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
    </Tabs>
  )
}
