"use client"

import * as React from "react"
import {
  BellRingIcon,
  CheckIcon,
  HistoryIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  ALERT_FREQUENCIES,
  DEFAULT_TIME_OF_DAY,
  FREQUENCY_LABELS,
  MAX_ALERT_ERRORS,
  MAX_ALERT_TEXT,
  STATUS_LABELS,
  WEEKDAY_LABELS,
  type AlertFrequency,
  type AlertStatus,
} from "@/lib/alertas"
import {
  ALERT_ATTACHMENT_TYPES,
  MAX_ALERT_ATTACHMENT_BYTES,
  MAX_ALERT_ATTACHMENT_FILES,
  MAX_ALERT_ATTACHMENT_TOTAL_BYTES,
} from "@/lib/attachments"
import { cn } from "cn"

import { Badge } from "@/components/reui/badge"
import { AttachmentChips } from "@/components/herramientas/attachment-chips"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
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
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatBytes } from "@/hooks/use-file-upload"
import { useAttachmentUpload } from "@/hooks/use-attachment-upload"
import { useRealtimeEvent } from "@/hooks/use-realtime"
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"

/*
 * Módulo Alertas. El tab «Crear» replica el layout del área de texto de
 * Imágenes → Crear (Card «Descripción» + micrófono en CardAction + adjuntos
 * inline + InputGroupTextarea). El tab «Mis alertas» lista las alertas con
 * su estado y su último hallazgo, y aloja el control «Avisos en este
 * dispositivo» (Web Push VAPID).
 */

interface InterpretedSpec {
  kind: "search" | "reminder"
  title: string
  query: string | null
  frequency: AlertFrequency | null
  timeOfDay: string | null
  weekday: number | null
  mode: "once" | "recurring" | null
  remindAt: string | null
}

interface AlertHitSummary {
  kind: "hit" | "reminder" | "error"
  title: string
  body: string
  sources: { title: string; url: string }[]
  checkedAt: string
}

interface AlertListItem {
  id: string
  kind: "search" | "reminder"
  status: AlertStatus
  mode: "once" | "recurring" | null
  sourceRequest: string
  title: string
  query: string | null
  frequency: AlertFrequency | null
  timeOfDay: string | null
  weekday: number | null
  remindAt: string | null
  lastCheckedAt: string | null
  lastHitAt: string | null
  checkCount: number
  errorCount: number
  lastError: string | null
  nextCheckAt: string
  lastHit: AlertHitSummary | null
}

interface AlertHit extends AlertHitSummary {
  id: string
  notified: boolean
}

type ListState = "loading" | "ready" | "error"

const STATUS_VARIANTS: Record<AlertStatus, "success-light" | "secondary" | "info-light" | "warning-light"> = {
  active: "success-light",
  paused: "secondary",
  done: "info-light",
  error: "warning-light",
}

const HIT_LABELS: Record<AlertHitSummary["kind"], string> = {
  hit: "Hallazgo",
  reminder: "Recordatorio",
  error: "Error",
}

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

function fechaLegible(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return "—"
  return dateTimeFormatter.format(new Date(parsed))
}

/** Junta el texto escrito con lo dictado, sin pasarse del límite. */
function joinTexto(base: string, spoken: string): string {
  const clean = spoken.trim()
  const previous = base.trim()
  const joined = clean ? (previous ? `${previous} ${clean}` : clean) : base
  return joined.length > MAX_ALERT_TEXT ? joined.slice(0, MAX_ALERT_TEXT) : joined
}

/** Copy del dictado según su estado (misma fuente para botón y avisos). */
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
    label: "Dictar la solicitud",
    tooltip: "Dictar la solicitud con la voz",
    error: "",
    status: "",
  }
}

/** Dominio de una fuente, sin "www.": etiqueta corta del enlace. */
function domainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/*
 * ── Web Push del dispositivo ────────────────────────────────────────────
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

type PushState =
  | "checking"
  | "unsupported"
  | "noVapid"
  | "denied"
  | "off"
  | "on"

/** Estados y acciones de la suscripción push del navegador actual. */
function usePushSubscription(vapidPublicKey: string | null) {
  const [state, setState] = React.useState<PushState>("checking")
  const [working, setWorking] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function initial() {
      if (!vapidPublicKey) {
        setState("noVapid")
        return
      }
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("unsupported")
        return
      }
      if (Notification.permission === "denied") {
        setState("denied")
        return
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration("/")
        const subscription = registration
          ? await registration.pushManager.getSubscription()
          : null
        if (!cancelled) setState(subscription ? "on" : "off")
      } catch {
        if (!cancelled) setState("off")
      }
    }
    void initial()
    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  const subscribe = React.useCallback(async () => {
    if (!vapidPublicKey) return
    setWorking(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission === "denied") {
        setState("denied")
        return
      }
      const registration = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }))
      const payload = subscription.toJSON()
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !body.ok) {
        throw new Error(body.error?.message ?? "No se pudo activar el aviso.")
      }
      setState("on")
      toast.success("Avisos activados en este dispositivo.")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo activar el aviso."
      )
    } finally {
      setWorking(false)
    }
  }, [vapidPublicKey])

  const unsubscribe = React.useCallback(async () => {
    setWorking(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration("/")
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null
      if (subscription) {
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe().catch(() => {})
      }
      setState("off")
      toast.info("Avisos desactivados en este dispositivo.")
    } catch {
      toast.error("No se pudo desactivar el aviso.")
    } finally {
      setWorking(false)
    }
  }, [])

  return { state, working, subscribe, unsubscribe }
}

/*
 * ── Card de descripción (tab Crear) ─────────────────────────────────────
 */

function SpecPreview({
  spec,
  onChange,
  aclaracion,
  sourceRequest,
}: {
  spec: InterpretedSpec
  onChange: (next: InterpretedSpec) => void
  aclaracion: string | null
  sourceRequest: string
}) {
  const isSearch = spec.kind === "search"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge variant={isSearch ? "info-light" : "primary-light"} size="lg">
            {isSearch ? "Búsqueda" : "Recordatorio"}
          </Badge>
          {spec.title}
        </CardTitle>
        <CardDescription className="line-clamp-3">
          «{sourceRequest}»
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {aclaracion ? (
          <p className="text-muted-foreground text-xs">{aclaracion}</p>
        ) : null}

        {isSearch ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="alerta-frecuencia">Revisar</Label>
              <Select
                items={ALERT_FREQUENCIES.map((frequency) => ({
                  value: frequency,
                  label: FREQUENCY_LABELS[frequency],
                }))}
                value={spec.frequency ?? "daily"}
                onValueChange={(value) =>
                  onChange({
                    ...spec,
                    frequency: value as AlertFrequency,
                    timeOfDay:
                      value === "daily" || value === "weekly"
                        ? spec.timeOfDay ?? DEFAULT_TIME_OF_DAY
                        : null,
                    weekday: value === "weekly" ? spec.weekday ?? 1 : null,
                  })
                }
              >
                <SelectTrigger id="alerta-frecuencia" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALERT_FREQUENCIES.map((frequency) => (
                    <SelectItem key={frequency} value={frequency}>
                      {FREQUENCY_LABELS[frequency]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {spec.frequency === "daily" || spec.frequency === "weekly" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="alerta-hora">A las</Label>
                <Input
                  id="alerta-hora"
                  type="time"
                  value={spec.timeOfDay ?? DEFAULT_TIME_OF_DAY}
                  onChange={(event) =>
                    onChange({ ...spec, timeOfDay: event.target.value })
                  }
                />
              </div>
            ) : null}
            {spec.frequency === "weekly" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="alerta-dia">Día de la semana</Label>
                <Select
                  items={WEEKDAY_LABELS.map((label, index) => ({
                    value: String(index),
                    label,
                  }))}
                  value={String(spec.weekday ?? 1)}
                  onValueChange={(value) =>
                    onChange({ ...spec, weekday: Number(value) })
                  }
                >
                  <SelectTrigger id="alerta-dia" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label>Comportamiento</Label>
              <ToggleGroup
                variant="default"
                value={[spec.mode ?? "once"]}
                onValueChange={(value) => {
                  const next = value[value.length - 1]
                  if (next === "once" || next === "recurring") {
                    onChange({ ...spec, mode: next })
                  }
                }}
              >
                <ToggleGroupItem
                  value="once"
                  className="aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
                >
                  Una sola vez
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="recurring"
                  className="aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
                >
                  Hasta que la pause
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            Se dispara el{" "}
            <span className="text-foreground font-medium">
              {spec.remindAt ? fechaLegible(spec.remindAt) : "—"}
            </span>{" "}
            (hora de Ciudad de México).
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/*
 * ── Studio principal ────────────────────────────────────────────────────
 */

type AlertasStudioProps = {
  /** false cuando falta GEMINI_API_KEY: la creación queda bloqueada. */
  llmConfigured: boolean
  /** Llave pública VAPID; null = push no configurado en el servidor. */
  vapidPublicKey: string | null
}

export function AlertasStudio({
  llmConfigured,
  vapidPublicKey,
}: AlertasStudioProps) {
  const [tab, setTab] = React.useState("crear")

  /*
   * Tab Crear: texto, adjuntos, interpretación y alta.
   */
  const [texto, setTexto] = React.useState("")
  const [interpreting, setInterpreting] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [interpretError, setInterpretError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<InterpretedSpec | null>(null)
  const [previewAclaracion, setPreviewAclaracion] = React.useState<string | null>(null)

  const textoRef = React.useRef<HTMLTextAreaElement>(null)

  const dictationBaseRef = React.useRef("")
  const dictationCancelledRef = React.useRef(false)

  const {
    isSupported: dictationSupported,
    isListening: dictating,
    error: dictationError,
    start: startDictation,
    stop: stopDictation,
  } = useSpeechRecognition({
    lang: "es-MX",
    onTranscript: (text) => {
      if (dictationCancelledRef.current || !text.trim()) return
      setTexto(joinTexto(dictationBaseRef.current, text))
    },
    onEnd: (text) => {
      const base = dictationBaseRef.current
      dictationBaseRef.current = ""
      if (dictationCancelledRef.current) {
        dictationCancelledRef.current = false
        return
      }
      if (text.trim()) {
        setTexto(joinTexto(base, text))
      }
      textoRef.current?.focus()
    },
  })

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
    if (interpreting || creating) return
    dictationBaseRef.current = texto
    startDictation()
  }, [
    creating,
    dictating,
    dictation,
    dictationSupported,
    interpreting,
    startDictation,
    stopDictation,
    texto,
  ])

  React.useEffect(() => {
    if (!dictationError) return
    toast.error(dictationError)
  }, [dictationError])

  const {
    attachments: attachmentItems,
    attachmentIds,
    uploading: uploadingAttachments,
    failed: failedAttachments,
    totalBytes: attachmentBytes,
    tooBig: attachmentsTooBig,
    error: referenceError,
    setError: setReferenceError,
    openFileDialog,
    getInputProps,
    remove: handleRemoveAttachment,
    detachAll,
  } = useAttachmentUpload({
    accept: ALERT_ATTACHMENT_TYPES.join(","),
    maxFiles: MAX_ALERT_ATTACHMENT_FILES,
    maxSize: MAX_ALERT_ATTACHMENT_BYTES,
    maxTotalBytes: MAX_ALERT_ATTACHMENT_TOTAL_BYTES,
    onInvalidFile: () => {
      setReferenceError(
        `Solo se admiten imágenes o PDF de hasta ${formatBytes(MAX_ALERT_ATTACHMENT_BYTES)} y máximo ${MAX_ALERT_ATTACHMENT_FILES} archivos por alerta.`
      )
    },
    onUploadError: (message) => toast.error(message),
  })

  const canInterpret =
    texto.trim().length > 0 &&
    llmConfigured &&
    !interpreting &&
    !creating &&
    !uploadingAttachments &&
    !failedAttachments &&
    !attachmentsTooBig

  async function interpret() {
    const trimmed = texto.trim()
    if (!trimmed || interpreting) return
    setInterpreting(true)
    setInterpretError(null)
    try {
      const response = await fetch("/api/alertas/interpretar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: trimmed, attachmentIds }),
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: { aclaracion: string | null; spec: InterpretedSpec | null }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        setInterpretError(
          body.error?.message ??
            "No se pudo interpretar la solicitud. Inténtalo de nuevo."
        )
        return
      }
      if (body.data.spec) {
        setPreview(body.data.spec)
        setPreviewAclaracion(body.data.aclaracion)
      } else {
        setPreview(null)
        setPreviewAclaracion(null)
        setInterpretError(
          body.data.aclaracion ?? "No entendí la solicitud como alerta."
        )
      }
    } catch {
      setInterpretError("No se pudo conectar con el servidor. Inténtalo de nuevo.")
    } finally {
      setInterpreting(false)
    }
  }

  function resetCreacion() {
    setPreview(null)
    setPreviewAclaracion(null)
    setInterpretError(null)
  }

  async function createAlert() {
    if (!preview || !texto.trim() || creating) return
    setCreating(true)
    try {
      const response = await fetch("/api/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: texto.trim(),
          alerta: preview,
          attachmentIds,
        }),
      })
      const body = (await response.json()) as {
        ok: boolean
        error?: { message?: string }
      }
      if (!response.ok || !body.ok) {
        toast.error(body.error?.message ?? "No se pudo crear la alerta.")
        return
      }
      toast.success("Alerta creada: te avisaré aquí y en tu campana.")
      // Los adjuntos ya quedaron ligados a la alerta: se limpian del editor
      // sin borrarlos del servidor (detachAll conserva los archivos).
      detachAll()
      setTexto("")
      resetCreacion()
      setTab("alertas")
      setListState("loading")
      setReloadToken((token) => token + 1)
    } catch {
      toast.error("No se pudo conectar con el servidor.")
    } finally {
      setCreating(false)
    }
  }

  /*
   * Tab Mis alertas: listado + push del dispositivo.
   */
  const [alerts, setAlerts] = React.useState<AlertListItem[]>([])
  const [listState, setListState] = React.useState<ListState>("loading")
  const [reloadToken, setReloadToken] = React.useState(0)
  const [busyAlertId, setBusyAlertId] = React.useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [hitsByAlert, setHitsByAlert] = React.useState<Record<string, AlertHit[]>>({})
  const [loadingHits, setLoadingHits] = React.useState(false)

  const push = usePushSubscription(vapidPublicKey)
  const [testingPush, setTestingPush] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/alertas", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          ok: boolean
          data?: { alerts: AlertListItem[] }
          error?: { message?: string }
        }
        if (!response.ok || !body.ok || !body.data) {
          throw new Error(body.error?.message ?? "Error al cargar las alertas")
        }
        setAlerts(body.data.alerts)
        setListState("ready")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setListState("error")
      })
    return () => controller.abort()
  }, [reloadToken])

  function reloadList() {
    setListState("loading")
    setReloadToken((token) => token + 1)
  }

  /*
   * Tiempo real entre dispositivos: el servidor publica eventos `alerts`
   * (creación, ajuste, borrado o resolución del scheduler) y este listado se
   * refresca en vivo. La recarga es silenciosa (mantiene los datos en
   * pantalla, sin esqueleto) y agrupada: una ráfaga de eventos produce un
   * solo refetch.
   */
  const expandedIdRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    expandedIdRef.current = expandedId
  }, [expandedId])

  /** Trae el historial de una alerta; false silencioso si falla. */
  async function refreshHistory(id: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/alertas/${id}`, { cache: "no-store" })
      const body = (await response.json()) as {
        ok: boolean
        data?: { hits: AlertHit[] }
      }
      if (response.ok && body.ok && body.data) {
        setHitsByAlert((current) => ({ ...current, [id]: body.data!.hits }))
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const silentReloadTimer = React.useRef<number | null>(null)
  const silentReload = React.useCallback(() => {
    setReloadToken((token) => token + 1)
    const expanded = expandedIdRef.current
    if (expanded) void refreshHistory(expanded)
  }, [])

  React.useEffect(() => {
    return () => {
      if (silentReloadTimer.current !== null) {
        window.clearTimeout(silentReloadTimer.current)
      }
    }
  }, [])

  useRealtimeEvent(["alerts"], () => {
    if (silentReloadTimer.current !== null) {
      window.clearTimeout(silentReloadTimer.current)
    }
    silentReloadTimer.current = window.setTimeout(() => {
      silentReloadTimer.current = null
      silentReload()
    }, 300)
  })

  // La app puede volver de segundo plano (PWA en el celular, pestaña oculta)
  // con eventos perdidos mientras nadie miraba: refresco directo al volver.
  React.useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) silentReload()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [silentReload])

  async function patchAlert(
    id: string,
    input: Record<string, unknown>
  ) {
    setBusyAlertId(id)
    try {
      const response = await fetch(`/api/alertas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: { alert: AlertListItem }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        toast.error(body.error?.message ?? "No se pudo actualizar la alerta.")
        return
      }
      setAlerts((current) =>
        current.map((alert) => (alert.id === id ? body.data!.alert : alert))
      )
    } catch {
      toast.error("No se pudo conectar con el servidor.")
    } finally {
      setBusyAlertId(null)
    }
  }

  async function deleteAlert(id: string) {
    setBusyAlertId(id)
    try {
      const response = await fetch(`/api/alertas/${id}`, { method: "DELETE" })
      const body = (await response.json()) as { ok?: boolean; error?: { message?: string } }
      if (!response.ok || !body.ok) {
        toast.error(body.error?.message ?? "No se pudo borrar la alerta.")
        return
      }
      setAlerts((current) => current.filter((alert) => alert.id !== id))
      toast.success("Alerta borrada.")
    } catch {
      toast.error("No se pudo conectar con el servidor.")
    } finally {
      setBusyAlertId(null)
      setConfirmDeleteId(null)
    }
  }

  async function openHistory(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (hitsByAlert[id]) return
    setLoadingHits(true)
    const loaded = await refreshHistory(id)
    if (!loaded) toast.error("No se pudo cargar el historial.")
    setLoadingHits(false)
  }

  async function testPush() {
    setTestingPush(true)
    try {
      const response = await fetch("/api/push/test", { method: "POST" })
      const body = (await response.json()) as {
        ok: boolean
        data?: { delivered: number }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok) {
        toast.error(body.error?.message ?? "No se pudo enviar el aviso de prueba.")
        return
      }
      if ((body.data?.delivered ?? 0) > 0) {
        toast.success("Aviso de prueba enviado.")
      } else {
        toast.info(
          "No hay dispositivos suscritos todavía desde este navegador."
        )
      }
    } catch {
      toast.error("No se pudo conectar con el servidor.")
    } finally {
      setTestingPush(false)
    }
  }

  const pushDisabledReason =
    push.state === "unsupported"
      ? "Este navegador no puede mostrar avisos del sistema. Usa Chrome o Edge en Android."
      : push.state === "noVapid"
        ? "El servidor no tiene avisos push configurados todavía."
        : push.state === "denied"
          ? "El permiso está bloqueado: rehabiítalo desde el candado del sitio en tu navegador."
          : null

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value as string)
        // Al entrar a «Mis alertas» se sincroniza por si el SSE cayó (así el
        // listado nunca queda viejo tras una desconexión).
        if (value === "alertas") silentReload()
      }}
    >
      {/* Barra de pestañas fija: mismo patrón que Imágenes. */}
      <div className="sticky top-0 z-10 -mx-4 mb-3.5 flex flex-col gap-2 bg-background px-4 md:-mx-6 md:px-6">
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="crear">Crear</TabsTrigger>
          <TabsTrigger value="alertas">Mis alertas</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="crear">
        <div className="flex flex-1 flex-col gap-4">
          {!llmConfigured ? (
            <p role="alert" className="text-destructive text-sm">
              El módulo de alertas no está configurado en el servidor (falta
              GEMINI_API_KEY). Contacta al administrador.
            </p>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Descripción</CardTitle>
              {/* El micrófono va a la derecha de la etiqueta, a su misma
                  altura: dictar es la otra forma de escribir la solicitud. */}
              <CardAction>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant={dictating ? "destructive" : "ghost"}
                        size="icon-sm"
                        onClick={toggleDictation}
                        disabled={interpreting || creating}
                        aria-label={dictation.label}
                        aria-pressed={dictating}
                        aria-disabled={!dictationSupported}
                        className="relative after:content-[''] after:absolute after:-inset-2 aria-disabled:opacity-50"
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
              {attachmentItems.length > 0 ? (
                <AttachmentChips
                  attachments={attachmentItems}
                  onRemove={handleRemoveAttachment}
                  disabled={interpreting || creating}
                />
              ) : null}
              {/* Bitono igual que en Imágenes: la celda de adjuntos lleva
                  fondo propio y el símbolo + grande; la solicitud vive en la
                  zona de la derecha. */}
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
                          aria-label="Adjuntar archivos de referencia"
                        />
                      }
                    >
                      <PlusIcon aria-hidden="true" className="size-5" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Adjuntar imágenes o PDF de referencia
                    </TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
                <InputGroupTextarea
                  ref={textoRef}
                  value={texto}
                  onChange={(event) => {
                    if (dictating) {
                      dictationCancelledRef.current = true
                      stopDictation()
                    }
                    const next = event.target.value
                    setTexto(
                      next.length > MAX_ALERT_TEXT
                        ? next.slice(0, MAX_ALERT_TEXT)
                        : next
                    )
                    resetCreacion()
                  }}
                  placeholder="Ejemplo: Avísame cuando baje el precio de la caja Android TV X96. O: Recuérdame cobrar a mis clientes el viernes a las 8 pm."
                  rows={4}
                  maxLength={MAX_ALERT_TEXT}
                  aria-label="Solicitud de la alerta"
                  className="resize-none placeholder:text-foreground/60"
                />
              </InputGroup>
              {preview || texto.trim() ? (
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTexto("")
                      resetCreacion()
                    }}
                    disabled={interpreting || creating}
                    title="Borra la descripción para escribir una alerta nueva desde cero"
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
              {texto.length >= MAX_ALERT_TEXT ? (
                <p role="status" className="text-muted-foreground text-xs">
                  Límite de {MAX_ALERT_TEXT} caracteres alcanzado: lo que
                  sigas dictando o escribiendo no se agrega.
                </p>
              ) : null}
              {referenceError ? (
                <p role="alert" className="text-destructive text-xs">
                  {referenceError}
                </p>
              ) : null}
              {attachmentsTooBig ? (
                <p role="alert" className="text-destructive text-xs">
                  Los adjuntos suman {formatBytes(attachmentBytes)}; el máximo
                  por alerta es {formatBytes(MAX_ALERT_ATTACHMENT_TOTAL_BYTES)}.
                </p>
              ) : null}
              {failedAttachments ? (
                <p role="alert" className="text-destructive text-xs">
                  Hay un archivo que no se pudo subir. Quítalo para continuar.
                </p>
              ) : null}
              <input
                {...getInputProps()}
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
              />
              {interpretError ? (
                <p
                  role="alert"
                  className="text-destructive text-sm transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
                >
                  {interpretError}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {preview ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => resetCreacion()}
                    disabled={creating || interpreting}
                  >
                    Cancelar
                  </Button>
                ) : null}
                {preview ? (
                  <Button
                    onClick={() => void createAlert()}
                    disabled={creating || uploadingAttachments || failedAttachments || attachmentsTooBig}
                  >
                    {creating ? (
                      <Spinner />
                    ) : (
                      <CheckIcon data-icon="inline-start" aria-hidden="true" />
                    )}
                    {creating ? "Creando…" : "Crear alerta"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => void interpret()}
                    disabled={!canInterpret}
                    title="La IA interpreta tu solicitud y te muestra la alerta para confirmar"
                  >
                    {interpreting ? (
                      <Spinner />
                    ) : (
                      <BellRingIcon data-icon="inline-start" aria-hidden="true" />
                    )}
                    {interpreting ? "Interpretando…" : "Interpretar"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          {preview ? (
            <SpecPreview
              spec={preview}
              onChange={(next) => setPreview(next)}
              aclaracion={previewAclaracion}
              sourceRequest={texto.trim()}
            />
          ) : null}
        </div>
      </TabsContent>

      <TabsContent value="alertas">
        <div className="flex flex-col gap-4">
          {/* Avisos del dispositivo: Web Push VAPID. */}
          <Card>
            <CardHeader>
              <CardTitle>Avisos en este dispositivo</CardTitle>
              <CardDescription>
                Recibe como notificación de sistema los hallazgos y
                recordatorios, además de la campana del panel.
              </CardDescription>
              <CardAction>
                <Switch
                  checked={push.state === "on"}
                  disabled={
                    push.working ||
                    push.state === "checking" ||
                    push.state === "unsupported" ||
                    push.state === "noVapid" ||
                    push.state === "denied"
                  }
                  onCheckedChange={(checked) => {
                    if (checked) void push.subscribe()
                    else void push.unsubscribe()
                  }}
                  aria-label="Avisos de sistema en este dispositivo"
                />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {push.state === "checking" ? (
                <p className="text-muted-foreground text-xs">Verificando…</p>
              ) : null}
              {pushDisabledReason ? (
                <p className="text-muted-foreground text-xs">
                  {pushDisabledReason}
                </p>
              ) : null}
              {push.state === "on" ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void testPush()}
                    disabled={testingPush}
                  >
                    {testingPush ? <Spinner /> : null}
                    Probar aviso
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    Debe llegar una notificación de sistema al instante.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Listado de alertas. */}
          <section aria-labelledby="alertas-titulo" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id="alertas-titulo" className="text-sm font-semibold tracking-tight">
                  Mis alertas
                </h2>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {listState === "loading"
                    ? "Cargando…"
                    : `${alerts.length} ${alerts.length === 1 ? "alerta" : "alertas"}`}
                </p>
              </div>
            </div>

            {listState === "loading" ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-32 w-full rounded-xl" />
                ))}
              </div>
            ) : null}

            {listState === "error" ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
                <p className="text-muted-foreground text-sm">
                  No pudimos cargar tus alertas.
                </p>
                <Button variant="outline" size="sm" onClick={reloadList}>
                  Reintentar
                </Button>
              </div>
            ) : null}

            {listState === "ready" && alerts.length === 0 ? (
              <Empty className="rounded-xl border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BellRingIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>Aún no hay alertas</EmptyTitle>
                  <EmptyDescription>
                    Describe en la pestaña Crear qué quieres vigilar y la IA lo
                    revisará por ti, o crea un recordatorio con hora.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTab("crear")
                      requestAnimationFrame(() => textoRef.current?.focus())
                    }}
                  >
                    Crear la primera alerta
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}

            {listState === "ready" && alerts.length > 0 ? (
              <div className="flex flex-col gap-3">
                {alerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    busy={busyAlertId === alert.id}
                    expanded={expandedId === alert.id}
                    hits={hitsByAlert[alert.id]}
                    loadingHits={loadingHits && expandedId === alert.id}
                    onTogglePause={() =>
                      void patchAlert(alert.id, {
                        status: alert.status === "active" ? "paused" : "active",
                      })
                    }
                    onDelete={() => setConfirmDeleteId(alert.id)}
                    onToggleHistory={() => void openHistory(alert.id)}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <AlertDialog
            open={confirmDeleteId !== null}
            onOpenChange={(open) => {
              if (!open) setConfirmDeleteId(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar esta alerta?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borra su historial de revisiones y deja de revisarse. Esta
                  acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (confirmDeleteId) void deleteAlert(confirmDeleteId)
                  }}
                >
                  Borrar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TabsContent>
    </Tabs>
  )
}

/*
 * ── Card de una alerta del listado ──────────────────────────────────────
 */

function AlertCard({
  alert,
  busy,
  expanded,
  hits,
  loadingHits,
  onTogglePause,
  onDelete,
  onToggleHistory,
}: {
  alert: AlertListItem
  busy: boolean
  expanded: boolean
  hits?: AlertHit[]
  loadingHits: boolean
  onTogglePause: () => void
  onDelete: () => void
  onToggleHistory: () => void
}) {
  const isSearch = alert.kind === "search"
  const scheduleLabel = isSearch
    ? [
        alert.frequency ? FREQUENCY_LABELS[alert.frequency] : null,
        alert.frequency === "weekly" && alert.weekday !== null
          ? WEEKDAY_LABELS[alert.weekday]
          : null,
        alert.timeOfDay ?? null,
      ]
        .filter(Boolean)
        .join(" · ")
    : alert.remindAt
      ? `Se dispara ${fechaLegible(alert.remindAt)}`
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{alert.title}</CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={onTogglePause}
                    aria-label={
                      alert.status === "active"
                        ? "Pausar alerta"
                        : "Reanudar alerta"
                    }
                    className="relative after:content-[''] after:absolute after:-inset-2"
                  />
                }
              >
                {alert.status === "active" ? (
                  <PauseIcon aria-hidden="true" />
                ) : (
                  <PlayIcon aria-hidden="true" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {alert.status === "active" ? "Pausar" : "Reanudar"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={onDelete}
                    aria-label="Borrar alerta"
                    className="relative after:content-[''] after:absolute after:-inset-2"
                  />
                }
              >
                <Trash2Icon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Borrar</TooltipContent>
            </Tooltip>
          </div>
        </CardAction>
        <CardDescription className="line-clamp-2">
          «{alert.sourceRequest}»
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={STATUS_VARIANTS[alert.status]}
            size="lg"
            radius="full"
          >
            {STATUS_LABELS[alert.status]}
          </Badge>
          <Badge variant="outline" size="lg" radius="full">
            {isSearch ? "Búsqueda" : "Recordatorio"}
          </Badge>
          {scheduleLabel ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {scheduleLabel}
            </span>
          ) : null}
        </div>
        {alert.status === "active" && alert.nextCheckAt ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {isSearch
              ? `Próxima revisión: ${fechaLegible(alert.nextCheckAt)}`
              : `Se dispara: ${fechaLegible(alert.nextCheckAt)}`}
          </p>
        ) : null}
        {alert.status === "error" && alert.lastError ? (
          <p className="text-warning-foreground text-xs">
            Falló {MAX_ALERT_ERRORS} veces seguidas: {alert.lastError}.
            Reanúdala cuando quieras.
          </p>
        ) : null}

        {alert.lastHit ? (
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-2.5">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  alert.lastHit.kind === "error" ? "warning-light" : "info-light"
                }
                size="sm"
                radius="full"
              >
                {HIT_LABELS[alert.lastHit.kind]}
              </Badge>
              <span className="text-muted-foreground text-xs tabular-nums">
                {fechaLegible(alert.lastHit.checkedAt)}
              </span>
            </div>
            <p className="text-sm font-medium">{alert.lastHit.title}</p>
            {alert.lastHit.body ? (
              <p className="text-muted-foreground line-clamp-3 text-xs">
                {alert.lastHit.body}
              </p>
            ) : null}
            {alert.lastHit.sources.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                {alert.lastHit.sources.slice(0, 3).map((source, index) => (
                  <span key={source.url}>
                    {index > 0 ? " · " : ""}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {domainLabel(source.url)}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleHistory}
            aria-expanded={expanded}
          >
            <HistoryIcon data-icon="inline-start" aria-hidden="true" />
            {expanded ? "Ocultar historial" : "Ver historial"}
          </Button>
          {alert.checkCount > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {alert.checkCount} {alert.checkCount === 1 ? "revisión" : "revisiones"}
            </span>
          ) : null}
        </div>

        {expanded ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            {loadingHits ? (
              <p className="text-muted-foreground text-xs">Cargando historial…</p>
            ) : hits && hits.length > 0 ? (
              hits.map((hit) => (
                <div key={hit.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {fechaLegible(hit.checkedAt)}
                    </span>
                    <Badge
                      variant={
                        hit.kind === "error" ? "warning-light" : "secondary"
                      }
                      size="sm"
                      radius="full"
                    >
                      {HIT_LABELS[hit.kind]}
                    </Badge>
                    {!hit.notified && hit.kind === "hit" ? (
                      <span className="text-muted-foreground text-xs">
                        (sin aviso nuevo: repetido)
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      "text-xs",
                      hit.kind === "error"
                        ? "text-warning-foreground"
                        : "text-foreground"
                    )}
                  >
                    {hit.title}
                    {hit.body ? ` — ${hit.body}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-xs">
                Todavía no hay revisiones registradas.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
