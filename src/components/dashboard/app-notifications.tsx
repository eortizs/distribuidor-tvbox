"use client"

/**
 * Campana de notificaciones de la cabecera (a la izquierda del avatar):
 * feed persistente de resultados de renovación (éxito/fallo, usuario
 * renovado y vencimiento nuevo) con contador de no leídas. Adaptado del
 * patrón ReUI `c-dropdown-menu-11` (Notification Feed): trigger campana con
 * insignia, filas con tile de iniciales, punto de no leída y «Marcar leídas».
 *
 * El feed vive en la base (tabla `notifications`), así que el comprador
 * consulta el histórico en cualquier momento. Las actualizaciones llegan en
 * vivo por SSE (`notifications`), y al abrir el menú se refresca siempre.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  BellIcon,
  CheckCheckIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { useRealtimeEvent } from "@/hooks/use-realtime"
import { Badge } from "@/components/reui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { formatFlujoDate } from "@/lib/flujotv"
import type { NotificationKind } from "@/server/notifications/service"

interface NotificationItem {
  id: string
  kind: NotificationKind
  title: string
  body: string
  user_name: string | null
  expires_at: string | null
  read_at: string | null
  created_at: string
}

interface Feed {
  items: NotificationItem[]
  unread: number
}

const relativeFormatter = new Intl.RelativeTimeFormat("es", {
  numeric: "auto",
})

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** «hace 5 minutos» / «hace 3 horas» / «hace 2 días»; luego fecha corta. */
function relativeTime(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ""
  const elapsed = parsed - Date.now()
  const abs = Math.abs(elapsed)
  if (abs < MINUTE_MS) return "hace un momento"
  if (abs < HOUR_MS)
    return relativeFormatter.format(Math.round(elapsed / MINUTE_MS), "minute")
  if (abs < DAY_MS)
    return relativeFormatter.format(Math.round(elapsed / HOUR_MS), "hour")
  if (abs < 7 * DAY_MS)
    return relativeFormatter.format(Math.round(elapsed / DAY_MS), "day")
  return formatFlujoDate(iso)
}

/** Iniciales del tile: primeras letras del usuario renovado. */
function initials(userName: string | null): string {
  const source = (userName ?? "").trim()
  if (!source) return "?"
  return source.slice(0, 2).toUpperCase()
}

const KIND_BADGE: Record<NotificationKind, { label: string; variant: "success-light" | "destructive-light" | "warning-light" }> = {
  renewal_success: { label: "Exitosa", variant: "success-light" },
  renewal_failed: { label: "Fallida", variant: "destructive-light" },
  transfer_rejected: { label: "Rechazada", variant: "warning-light" },
}

const SKELETON_ROWS = 4

export function AppNotifications() {
  const [open, setOpen] = useState(false)
  const [feed, setFeed] = useState<Feed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  /** Evita pisar una respuesta vieja sobre una nueva al recargar en serie. */
  const requestIdRef = useRef(0)

  /** Carga el feed sin pisar respuestas viejas si llegan recargas en serie. */
  const load = useCallback(() => {
    const requestId = ++requestIdRef.current
    return fetch("/api/notificaciones", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`feed ${response.status}`)
        const payload = (await response.json()) as { ok: boolean; data: Feed }
        if (requestId !== requestIdRef.current) return
        setFeed(payload.data)
        setError(false)
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return
        setError(true)
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // En vivo: cada nueva notificación (y cada lectura/borrado de otra pestaña)
  // refresca feed e insignia sin abrir el menú.
  useRealtimeEvent(["notifications"], () => {
    void load()
  })

  const applyUnread = (unread: number): void => {
    setFeed((prev) => (prev ? { ...prev, unread } : prev))
  }

  const markRead = async (ids?: string[]): Promise<void> => {
    try {
      const response = await fetch("/api/notificaciones/leer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      })
      if (!response.ok) throw new Error()
      const payload = (await response.json()) as {
        data: { unread: number }
      }
      applyUnread(payload.data.unread)
      setFeed((prev) =>
        prev
          ? {
              unread: payload.data.unread,
              items: prev.items.map((item) =>
                !item.read_at && (!ids || ids.includes(item.id))
                  ? { ...item, read_at: new Date().toISOString() }
                  : item
              ),
            }
          : prev
      )
    } catch {
      toast.error("No se pudo marcar como leídas.")
    }
  }

  const removeNotifications = async (ids?: string[]): Promise<void> => {
    try {
      const response = await fetch("/api/notificaciones", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      })
      if (!response.ok) throw new Error()
      const payload = (await response.json()) as {
        data: { unread: number }
      }
      applyUnread(payload.data.unread)
      setFeed((prev) =>
        prev
          ? {
              unread: payload.data.unread,
              items: ids
                ? prev.items.filter((item) => !ids.includes(item.id))
                : [],
            }
          : prev
      )
    } catch {
      toast.error("No se pudo borrar la notificación.")
    }
  }

  const items = feed?.items ?? []
  const unread = feed?.unread ?? 0
  const busy = loading && !feed

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          // Al abrir siempre refresca: cubre el caso de SSE caído o de
          // notificaciones creadas mientras la pestaña estuvo oculta.
          if (nextOpen) void load()
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                unread > 0
                  ? `Notificaciones, ${unread} sin leer`
                  : "Notificaciones"
              }
              className="relative"
            />
          }
        >
          <BellIcon aria-hidden="true" />
          {unread > 0 ? (
            <Badge
              variant="destructive"
              size="sm"
              className="absolute -top-1 -right-1.5 rounded-full px-1"
              aria-hidden="true"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="end" sideOffset={8}>
          {/* GroupLabel (DropdownMenuLabel) exige el contexto de Menu.Group:
              sin este grupo Base UI lanza el error #31 al abrir el menú. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                Notificaciones
                {unread > 0 ? (
                  <Badge variant="secondary" size="sm">
                    {unread}
                  </Badge>
                ) : null}
              </span>
              <span className="flex items-center gap-1">
                {unread > 0 ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void markRead()}
                    disabled={busy}
                  >
                    <CheckCheckIcon data-icon="inline-start" />
                    Marcar leídas
                  </Button>
                ) : null}
                {items.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setConfirmClear(true)}
                    aria-label="Borrar todas las notificaciones"
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                ) : null}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
          {busy ? (
            <div className="flex flex-col gap-1 px-1 pb-2">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <div key={index} className="flex items-start gap-2 py-1">
                  <Skeleton className="mt-0.5 size-6 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-3/5" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No se pudieron cargar las notificaciones.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
              >
                <RotateCwIcon data-icon="inline-start" />
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin notificaciones. Los resultados de las operaciones aparecerán
              aquí.
            </p>
          ) : (
            <DropdownMenuGroup>
              {items.map((item) => {
                const badge = KIND_BADGE[item.kind]
                const isUnread = item.read_at === null
                return (
                  <DropdownMenuItem
                    key={item.id}
                    className="flex items-start gap-2 py-1.5"
                    closeOnClick={false}
                    onClick={() => {
                      if (isUnread) void markRead([item.id])
                    }}
                  >
                    <Avatar className="mt-0.5 size-6 shrink-0">
                      <AvatarFallback>{initials(item.user_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col gap-px">
                      <p className="flex items-center gap-1.5 leading-snug">
                        <span className="truncate font-medium">{item.title}</span>
                        <Badge variant={badge.variant} size="xs">
                          {badge.label}
                        </Badge>
                      </p>
                      <p className="line-clamp-2 text-muted-foreground">
                        {item.body}
                      </p>
                      <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                        {item.expires_at ? (
                          <span>
                            Vence {formatFlujoDate(item.expires_at)}
                          </span>
                        ) : null}
                        <span>{relativeTime(item.created_at)}</span>
                      </span>
                    </div>
                    <span
                      className="flex shrink-0 flex-col items-center gap-1 pt-0.5"
                    >
                      {isUnread ? (
                        <span
                          aria-hidden="true"
                          className="bg-primary size-1.5 shrink-0 rounded-full"
                        />
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Borrar notificación de ${item.user_name ?? "renovación"}`}
                        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation()
                          void removeNotifications([item.id])
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar todas las notificaciones?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán las {items.length} notificaciones de tu cuenta,
              incluidas las sin leer. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                setConfirmClear(false)
                void removeNotifications()
              }}
            >
              Borrar todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
