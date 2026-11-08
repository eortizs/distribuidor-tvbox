"use client"

/**
 * Revisión de transferencias bancarias (solo admin, arriba del listado de
 * `/clientes`): cada orden `pending` con su ticket, la acción «Ver ticket»
 * (abre el comprobante en otra pestaña vía `/api/transferencias/orders/[id]/ticket`)
 * y el par Aprobar/Rechazar. Aprobar reclama la orden hacia `paid` y renueva
 * la licencia en el panel (la renovación fallida queda `renewal_failed` para
 * el reintento admin de Mercado Pago); rechazar marca `rejected` sin
 * renovación, con confirmación previa por ser destructivo. La sección se
 * recarga con los eventos en tiempo real de órdenes y desaparece sola cuando
 * no queda nada pendiente.
 */

import { useCallback, useEffect, useState } from "react"
import {
  FileTextIcon,
  ImageIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useRealtimeEvent } from "@/hooks/use-realtime"
import { formatBytes } from "@/hooks/use-file-upload"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { formatMxn } from "@/lib/finanzas"
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
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  approveTransferOrder,
  fetchPendingTransferOrders,
  rejectTransferOrder,
  type TransferOrder,
} from "./pago-api"

function TicketIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/") ? ImageIcon : FileTextIcon
  return <Icon aria-hidden="true" className="size-4 shrink-0 opacity-60" />
}

/** Momento legible de la orden: «7 nov, 11:32». */
function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

export function TransferenciasReview({
  onApproved,
}: {
  /** Refresca la fila del cliente tras aplicar la renovación. */
  onApproved: (userName: string) => void
}) {
  const [orders, setOrders] = useState<TransferOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<TransferOrder | null>(null)

  const load = useCallback(() => {
    fetchPendingTransferOrders()
      .then((data) => {
        setOrders(data)
        setError(null)
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudieron cargar las transferencias."
        )
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** Las órdenes cambian en otro dispositivo (u otra revisión): recargar. */
  useRealtimeEvent(["mp_order"], load)

  const dropOrder = useCallback((orderId: string) => {
    setOrders((rows) => rows?.filter((row) => row.id !== orderId) ?? null)
  }, [])

  const approve = useCallback(
    async (order: TransferOrder) => {
      setActingId(order.id)
      try {
        const result = await approveTransferOrder(order.id)
        const monthsLabel = `${order.months} ${order.months === 1 ? "mes" : "meses"}`
        if (result.status === "renewed") {
          toast.success("Renovación aplicada", {
            description: `${order.user_name} · ${monthsLabel} · ${formatMxn(order.amount)}`,
          })
          onApproved(order.user_name)
        } else if (result.status === "renewal_failed") {
          toast.error("El pago se aprobó pero la renovación falló", {
            description: `Reintenta la renovación de la orden ${order.id}.`,
          })
        } else {
          toast.info(`Transferencia en estado «${result.status}»`)
        }
        dropOrder(order.id)
      } catch (cause: unknown) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : "No se pudo aprobar la transferencia."
        )
      } finally {
        setActingId(null)
      }
    },
    [dropOrder, onApproved]
  )

  const reject = useCallback(
    async (order: TransferOrder) => {
      setActingId(order.id)
      try {
        await rejectTransferOrder(order.id)
        toast.success("Transferencia rechazada", {
          description: `${order.user_name} · sin cargo ni renovación.`,
        })
        dropOrder(order.id)
      } catch (cause: unknown) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : "No se pudo rechazar la transferencia."
        )
      } finally {
        setActingId(null)
        setRejectTarget(null)
      }
    },
    [dropOrder]
  )

  // Mientras carga o sin pendientes la sección no existe: cero ruido.
  if (orders === null && !error) return null

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>No se pudieron cargar las transferencias</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
        </AlertDescription>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCwIcon aria-hidden="true" />
          Reintentar
        </Button>
      </Alert>
    )
  }

  const pending = orders ?? []
  if (pending.length === 0) return null

  return (
    <Card size="sm" className="gap-0 py-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">
          Transferencias por revisar
        </h2>
        <Badge variant="warning-light" size="xs">
          {pending.length}
        </Badge>
      </div>
      <Separator />
      <ul className="flex flex-col">
        {pending.map((order, index) => {
          const acting = actingId === order.id
          return (
            <li key={order.id} className="flex flex-col">
              {index > 0 ? <Separator /> : null}
              <div className="flex flex-col gap-2.5 px-4 py-3">
                <div className="flex items-center gap-3">
                  {order.ticket ? (
                    <TicketIcon mimeType={order.ticket.mimeType} />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {order.user_name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {order.months} {order.months === 1 ? "mes" : "meses"} ·{" "}
                      {formatMxn(order.amount)} ·{" "}
                      {order.buyer_username ?? "sin comprador"} ·{" "}
                      {formatWhen(order.created_at)}
                    </p>
                  </div>
                  {order.ticket ? (
                    <Badge
                      variant="secondary"
                      radius="full"
                      className="max-w-40 gap-1.5"
                      title={`${order.ticket.fileName} · ${formatBytes(order.ticket.sizeBytes)}`}
                    >
                      <span className="min-w-0 truncate">
                        {order.ticket.fileName}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="destructive-light" size="xs">
                      Sin ticket
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  {order.ticket ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      render={
                        <a
                          href={`/api/transferencias/orders/${encodeURIComponent(order.id)}/ticket`}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      Ver ticket
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={actingId !== null}
                      onClick={() => setRejectTarget(order)}
                    >
                      Rechazar
                    </Button>
                    <Button
                      size="sm"
                      disabled={actingId !== null}
                      onClick={() => void approve(order)}
                    >
                      {acting ? (
                        <LoaderCircleIcon
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      ) : null}
                      Aprobar
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <AlertDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Rechazar la transferencia de {rejectTarget?.user_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El pago no se registrará y la licencia no se renovará; el
              distribuidor deberá subir otro comprobante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actingId !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={actingId !== null}
              onClick={(event) => {
                event.preventDefault()
                if (rejectTarget) void reject(rejectTarget)
              }}
            >
              Rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
